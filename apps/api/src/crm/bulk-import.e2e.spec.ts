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
import { LeadEventType } from '@agentos/contracts';
import { type LeadActor } from '@agentos/crm-lead';
import { BulkImportOrchestrator } from './bulk-import.orchestrator';

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd(), '../..');

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 20_000,
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
 * RFC-002 Phase 4b gate: bulk CSV import. Drives the real `BulkImportOrchestrator` + the in-process
 * BullMQ worker (no HTTP — Phase 6) against the real app as `app_user`, with throwaway PG + Redis.
 * Proves: an import normalizes/dedups/inserts and reports accurate counts with one `LeadImported`
 * event; **re-submitting the same Idempotency-Key never double-creates** (the gate); a different key
 * is a fresh import; and an unmappable row is counted `failed` without aborting the run. That the full
 * suite doesn't hang also proves the worker closes cleanly on shutdown.
 */
describe('CRM bulk import (Phase 4b gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let orchestrator: BulkImportOrchestrator;
  let actor: LeadActor;

  const leadCount = async (): Promise<number> => {
    const [row] = await admin`
      SELECT count(*)::int AS n FROM leads
      WHERE organization_id = ${actor.organizationId} AND workspace_id = ${actor.workspaceId}`;
    return Number(row!.n);
  };

  const jobRow = async (jobId: string) =>
    (await admin`SELECT status, total_rows, created_count, skipped_count, failed_count, error_report
                 FROM import_jobs WHERE id = ${jobId}`)[0];

  const awaitCompletion = (jobId: string) =>
    waitFor(async () => {
      const row = await jobRow(jobId);
      return row && row.status === 'completed' ? row : null;
    });

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
    app.enableShutdownHooks(); // ensure OnApplicationShutdown runs so the worker/queue close cleanly
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

    const email = `owner-${randomUUID()}@example.com`;
    await http
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery staple', displayName: 'Ada Lovelace', tokenDelivery: 'body' })
      .expect(201);
    const [user] = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    const principalId = user!.id as string;
    const [org] = await admin`SELECT id FROM organizations WHERE created_by = ${principalId}`;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${org!.id as string}`;

    orchestrator = app.get(BulkImportOrchestrator, { strict: false });
    actor = {
      principalId,
      organizationId: org!.id as string,
      workspaceId: ws!.id as string,
      correlationId: randomUUID(),
    };
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  const eventCount = async (aggregateId: string, type: string): Promise<number> => {
    const [row] = await admin`
      SELECT count(*)::int AS n FROM domain_events
      WHERE aggregate_id = ${aggregateId} AND event_type = ${type}`;
    return Number(row!.n);
  };

  it('imports rows, dedupes by email, reports counts, and emits one LeadImported', async () => {
    const before = await leadCount();
    const csv =
      'name,email,phone,domain,source\n' +
      'Ada Lovelace,ada@example.com,,example.com,web\n' +
      'Grace Hopper,grace@navy.mil,,navy.mil,web\n' +
      'Ada Again,ADA@example.com,,example.com,web\n' + // dup email of row 1 → skipped
      'Alan Turing,alan@bletchley.uk,,bletchley.uk,web\n';

    const { jobId, alreadyExists } = await orchestrator.submit(actor, {
      idempotencyKey: `imp-${randomUUID()}`,
      csv,
    });
    expect(alreadyExists).toBe(false);

    const row = await awaitCompletion(jobId);
    expect(row!.total_rows).toBe(4);
    expect(row!.created_count).toBe(3);
    expect(row!.skipped_count).toBe(1);
    expect(row!.failed_count).toBe(0);
    expect(await leadCount()).toBe(before + 3);
    expect(await eventCount(jobId, LeadEventType.LeadImported)).toBe(1);
  });

  it('idempotency (gate): re-submitting the same key returns the same job and never double-creates', async () => {
    const key = `imp-${randomUUID()}`;
    const csv = 'name,email,phone,domain,source\nFirst Last,first@dedupe.test,,dedupe.test,web\n';

    const first = await orchestrator.submit(actor, { idempotencyKey: key, csv });
    expect(first.alreadyExists).toBe(false);
    await awaitCompletion(first.jobId);
    const afterFirst = await leadCount();

    // Same key again — returns the same job, does NOT enqueue, does NOT re-create.
    const replay = await orchestrator.submit(actor, { idempotencyKey: key, csv });
    expect(replay.alreadyExists).toBe(true);
    expect(replay.jobId).toBe(first.jobId);
    await new Promise((r) => setTimeout(r, 500)); // give any (erroneous) re-processing a chance
    expect(await leadCount()).toBe(afterFirst);
    expect(await eventCount(first.jobId, LeadEventType.LeadImported)).toBe(1);
  });

  it('a different key is a fresh import that creates new leads', async () => {
    const before = await leadCount();
    const csv = 'name,email,phone,domain,source\nNew Person,newkey@fresh.test,,fresh.test,web\n';
    const { jobId } = await orchestrator.submit(actor, { idempotencyKey: `imp-${randomUUID()}`, csv });
    const row = await awaitCompletion(jobId);
    expect(row!.created_count).toBe(1);
    expect(await leadCount()).toBe(before + 1);
  });

  it('an unmappable row is counted failed without aborting valid rows', async () => {
    const before = await leadCount();
    const csv =
      'name,email,phone,domain,source\n' +
      'Valid Person,valid@rows.test,,rows.test,web\n' +
      ',,,,\n'; // empty → no usable data → failed

    const { jobId } = await orchestrator.submit(actor, { idempotencyKey: `imp-${randomUUID()}`, csv });
    const row = await awaitCompletion(jobId);
    expect(row!.created_count).toBe(1);
    expect(row!.failed_count).toBe(1);
    expect((row!.error_report as { errors?: unknown[] }).errors?.length).toBe(1);
    expect(await leadCount()).toBe(before + 1);
  });
});
