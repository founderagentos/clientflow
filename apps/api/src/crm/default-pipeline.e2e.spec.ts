import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';
import { DATABASE, withTenantTransaction, type Database } from '@agentos/persistence-kernel';
import { DefaultPipelineRepository } from '@agentos/crm-deal';

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd(), '../..');

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * RFC-002 Phase 1: when a workspace is created, the CRM deal module's DefaultPipelineProvisioner
 * consumes the kernel `WorkspaceCreated` event (the kernel stays CRM-unaware) and seeds the default
 * 6-stage pipeline. Runs the real app as the RLS-subject `app_user`, with the relay on the
 * privileged `event_relay` connection, against throwaway Postgres + Redis — the seed is asynchronous
 * (post-commit via the relay), so we poll for it.
 */
describe('CRM default pipeline seeding (Phase 1)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  const expectedStages = [
    { name: 'Lead In', position: 1, probability: '0.10', category: 'open' },
    { name: 'Qualified', position: 2, probability: '0.25', category: 'open' },
    { name: 'Proposal Sent', position: 3, probability: '0.50', category: 'open' },
    { name: 'Negotiation', position: 4, probability: '0.75', category: 'open' },
    { name: 'Won', position: 5, probability: '1.00', category: 'won' },
    { name: 'Lost', position: 6, probability: '0.00', category: 'lost' },
  ];

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:18').start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);
    admin = postgres(pg.getConnectionUri(), { max: 1 });

    await migrate(drizzle(admin), { migrationsFolder: join(repoRoot, 'db/migrations') });
    await execFileAsync(
      join(repoRoot, 'node_modules/.bin/tsx'),
      [join(repoRoot, 'db/policies/apply-policies.ts')],
      {
        env: {
          ...process.env,
          DATABASE_URL: pg.getConnectionUri(),
          APP_USER_DB_PASSWORD: 'app_user_pw',
          PLATFORM_OPERATOR_DB_PASSWORD: 'platform_operator_pw',
          EVENT_RELAY_DB_PASSWORD: 'event_relay_pw',
        },
      },
    );
    await execFileAsync(join(repoRoot, 'node_modules/.bin/tsx'), [join(repoRoot, 'db/seed/seed.ts')], {
      env: { ...process.env, DATABASE_URL: pg.getConnectionUri() },
    });

    const appUserUrl = new URL(pg.getConnectionUri());
    appUserUrl.username = 'app_user';
    appUserUrl.password = 'app_user_pw';
    const relayUrl = new URL(pg.getConnectionUri());
    relayUrl.username = 'event_relay';
    relayUrl.password = 'event_relay_pw';

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = appUserUrl.toString();
    process.env.EVENT_RELAY_DATABASE_URL = relayUrl.toString();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    process.env.AUTH_COOKIE_SECURE = 'false';

    const { AppModule } = await import('../app.module');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(fastifyCookie);
    fastify.addHook('onRequest', (req, reply, done) => {
      void reply.header('x-correlation-id', (req.headers['x-correlation-id'] as string) ?? randomUUID());
      done();
    });
    await app.init();
    await fastify.ready();
    http = request(fastify.server);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('seeds exactly one default pipeline with the 6 standard stages for a new workspace', async () => {
    const email = `owner-${randomUUID()}@example.com`;
    await http
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery staple', displayName: 'Ada Lovelace', tokenDelivery: 'body' })
      .expect(201);

    const [user] = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    const [org] = await admin`SELECT id FROM organizations WHERE created_by = ${user!.id as string}`;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${org!.id as string}`;
    const workspaceId = ws!.id as string;

    // Seeding is async (relay → consumer). Poll for the default pipeline.
    const pipeline = await waitFor(async () => {
      const [row] = await admin`
        SELECT id FROM pipelines
        WHERE workspace_id = ${workspaceId} AND is_default = true AND deleted_at IS NULL`;
      return row ?? null;
    });

    const allDefaults = await admin`
      SELECT id FROM pipelines WHERE workspace_id = ${workspaceId} AND is_default = true`;
    expect(allDefaults).toHaveLength(1);

    const stages = await admin`
      SELECT name, position, probability, category FROM pipeline_stages
      WHERE pipeline_id = ${pipeline.id as string} ORDER BY position`;
    expect(
      stages.map((s) => ({
        name: s.name,
        position: s.position,
        probability: s.probability,
        category: s.category,
      })),
    ).toEqual(expectedStages);
  });

  it('is idempotent — re-delivering WorkspaceCreated does not create a second pipeline', async () => {
    const email = `owner-${randomUUID()}@example.com`;
    await http
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery staple', displayName: 'Grace Hopper', tokenDelivery: 'body' })
      .expect(201);

    const [user] = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    const [org] = await admin`SELECT id FROM organizations WHERE created_by = ${user!.id as string}`;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${org!.id as string}`;
    const workspaceId = ws!.id as string;

    const pipeline = await waitFor(async () => {
      const [row] = await admin`
        SELECT id FROM pipelines WHERE workspace_id = ${workspaceId} AND is_default = true`;
      return row ?? null;
    });

    // Re-run the seed for the same workspace via the consumer's repository directly; the pre-check
    // + partial unique must make it a no-op (no second default pipeline).
    const db = app.get<Database>(DATABASE, { strict: false });
    const repo = app.get(DefaultPipelineRepository, { strict: false });
    const created = await withTenantTransaction(
      db,
      { organizationId: org!.id as string, workspaceId },
      (tx) =>
        repo.seedDefault(tx, {
          organizationId: org!.id as string,
          workspaceId,
          actorPrincipalId: user!.id as string,
        }),
    );
    expect(created).toBe(false);

    const defaults = await admin`
      SELECT id FROM pipelines WHERE workspace_id = ${workspaceId} AND is_default = true`;
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(pipeline.id);
  });
});
