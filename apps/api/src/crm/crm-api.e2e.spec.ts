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

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd(), '../..');

/**
 * RFC-002 Phase 6 gate: the CRM HTTP API + edge. Drives the real app over HTTP (supertest) and proves
 * the controllers expose the built CRM services correctly with the kernel edge inherited for free:
 * CRUD + view shape, optimistic-lock 409, keyset pagination, default-deny at the API guard (layer 1)
 * for a service-account, the action sub-resources (stage transition + one-shot conversion), edge
 * validation (422), the bulk-import idempotency edge, the sensitive erase gate, and a clean OpenAPI
 * 3.1 document.
 */
describe('CRM HTTP API (Phase 6 gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let ownerToken: string;
  let workspaceId: string;

  // The Owner's token is org-level (workspace null); CRM is workspace-scoped, so every Owner request
  // selects the active workspace via X-Workspace-Id (RFC-002 §6 active-workspace selection).
  const asOwner = (r: request.Test) =>
    r.set('Authorization', `Bearer ${ownerToken}`).set('X-Workspace-Id', workspaceId);

  /** Provision a service account with exactly `permissions` and return a usable API key (plaintext). */
  async function provisionAgentKey(permissions: string[]): Promise<string> {
    const role = (
      await asOwner(http.post('/api/v1/roles')).send({ name: `role-${randomUUID()}`, scope: 'workspace' })
    ).body as { roleId: string };
    for (const permissionKey of permissions) {
      await asOwner(http.post(`/api/v1/roles/${role.roleId}/permissions`)).send({ permissionKey });
    }
    const sa = (
      await asOwner(http.post('/api/v1/service-accounts')).send({
        name: `sa-${randomUUID()}`,
        kind: 'agent',
        workspaceId,
        roleId: role.roleId,
      })
    ).body as { serviceAccountId: string };
    const issued = (
      await asOwner(http.post(`/api/v1/service-accounts/${sa.serviceAccountId}/api-keys`)).send({})
    ).body as { apiKey: string };
    return issued.apiKey;
  }

  const newAccountId = async (): Promise<string> => {
    const res = await asOwner(http.post('/api/v1/accounts')).send({ name: `Acct ${randomUUID()}` }).expect(201);
    return (res.body as { id: string }).id;
  };

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
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(fastifyCookie);
    // Mirror main.ts: the bulk-import route reads a raw `text/csv` body.
    fastify.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    fastify.addHook('onRequest', (req, reply, done) => {
      void reply.header('x-correlation-id', (req.headers['x-correlation-id'] as string) ?? randomUUID());
      done();
    });
    await app.init();
    await fastify.ready();
    http = request(fastify.server);

    const email = `owner-${randomUUID()}@example.com`;
    ownerToken = (
      await http
        .post('/api/v1/auth/register')
        .send({ email, password: 'correct horse battery staple', displayName: 'Ada Lovelace', tokenDelivery: 'body' })
        .expect(201)
    ).body.access_token as string;

    const [user] = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    const [org] = await admin`SELECT id FROM organizations WHERE created_by = ${user!.id as string}`;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${org!.id as string}`;
    workspaceId = ws!.id as string;

    // The default pipeline is seeded async by the WorkspaceCreated consumer; deal.create needs it.
    for (let i = 0; i < 150; i++) {
      const [row] = await admin`SELECT id FROM pipelines WHERE workspace_id = ${workspaceId} AND is_default = true`;
      if (row) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('CRUD round-trip + view shape + optimistic-lock 409', async () => {
    const created = await asOwner(http.post('/api/v1/accounts')).send({ name: 'Globex', domain: 'globex.com' }).expect(201);
    const account = created.body as { id: string; version: number; name: string };
    expect(account.id).toBeTruthy();
    expect(account.name).toBe('Globex');
    expect(account).not.toHaveProperty('deletedAt'); // the view never leaks internal columns

    await asOwner(http.get(`/api/v1/accounts/${account.id}`)).expect(200);

    // Stale expectedVersion → 409 conflict (CLAUDE.md §3.4).
    await asOwner(http.patch(`/api/v1/accounts/${account.id}`))
      .send({ expectedVersion: account.version + 99, name: 'Nope' })
      .expect(409)
      .expect((r) => expect((r.body as { code: string }).code).toBe('version_conflict'));

    // Correct version → 200.
    const updated = await asOwner(http.patch(`/api/v1/accounts/${account.id}`))
      .send({ expectedVersion: account.version, industry: 'Tech' })
      .expect(200);
    expect((updated.body as { industry: string }).industry).toBe('Tech');
  });

  it('keyset pagination returns a bounded page + a followable cursor', async () => {
    const accountId = await newAccountId();
    for (let i = 0; i < 3; i++) {
      await asOwner(http.post('/api/v1/deals')).send({ accountId }).expect(201);
    }
    const first = await asOwner(http.get('/api/v1/deals')).query({ limit: 2 }).expect(200);
    const firstBody = first.body as { items: { id: string }[]; nextCursor: string | null };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await asOwner(http.get('/api/v1/deals'))
      .query({ limit: 2, cursor: firstBody.nextCursor })
      .expect(200);
    const secondIds = (second.body as { items: { id: string }[] }).items.map((d) => d.id);
    const firstIds = firstBody.items.map((d) => d.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false); // no overlap across pages
  });

  it('default-deny at the API guard: a service-account lacking deal.create is rejected with 403', async () => {
    const key = await provisionAgentKey(['lead.read']); // no deal.create, no contact.erase
    const accountId = await newAccountId();
    await http
      .post('/api/v1/deals')
      .set('x-api-key', key)
      .send({ accountId })
      .expect(403)
      .expect((r) => expect((r.body as { code: string }).code).toBe('forbidden'));
  });

  it('action sub-resources: stage transition moves the deal, conversion is one-shot', async () => {
    // Stage transition to another open stage of the default pipeline.
    const accountId = await newAccountId();
    const deal = (await asOwner(http.post('/api/v1/deals')).send({ accountId }).expect(201)).body as {
      id: string;
      stageId: string;
      version: number;
    };
    const pipelines = (await asOwner(http.get('/api/v1/pipelines')).expect(200)).body as { id: string; isDefault: boolean }[];
    const defaultPipeline = pipelines.find((p) => p.isDefault)!;
    const board = (await asOwner(http.get(`/api/v1/pipelines/${defaultPipeline.id}/board`)).expect(200)).body as {
      stages: { stageId: string; category: string }[];
    };
    const target = board.stages.find((s) => s.category === 'open' && s.stageId !== deal.stageId)!;
    const moved = await asOwner(http.post(`/api/v1/deals/${deal.id}/stage-transitions`))
      .send({ toStageId: target.stageId, expectedVersion: deal.version })
      .expect(200);
    expect((moved.body as { stageId: string }).stageId).toBe(target.stageId);

    // One-shot lead conversion.
    const lead = (await asOwner(http.post('/api/v1/leads')).send({ name: 'Lead Co', domain: 'lead-co.com' }).expect(201))
      .body as { id: string };
    const convert = await asOwner(http.post(`/api/v1/leads/${lead.id}/conversion`)).send({}).expect(201);
    const result = convert.body as { accountId: string; contactId: string; dealId: string; alreadyConverted: boolean };
    expect(result.accountId).toBeTruthy();
    expect(result.dealId).toBeTruthy();
    expect(result.alreadyConverted).toBe(false);

    const replay = await asOwner(http.post(`/api/v1/leads/${lead.id}/conversion`)).send({}).expect(201);
    const replayed = replay.body as { accountId: string; dealId: string; alreadyConverted: boolean };
    expect(replayed.alreadyConverted).toBe(true);
    expect(replayed.accountId).toBe(result.accountId);
    expect(replayed.dealId).toBe(result.dealId);
  });

  it('edge validation: a malformed body is 422 validation_failed', async () => {
    await asOwner(http.post('/api/v1/accounts'))
      .send({ domain: 'no-name.com' }) // `name` required
      .expect(422)
      .expect((r) => expect((r.body as { code: string }).code).toBe('validation_failed'));
  });

  it('bulk import: text/csv + Idempotency-Key is idempotent', async () => {
    const key = `imp-${randomUUID()}`;
    const csv = 'name,email,domain\nAcme,info@acme.test,acme.test\n';
    const first = await asOwner(http.post('/api/v1/imports'))
      .set('Idempotency-Key', key)
      .set('Content-Type', 'text/csv')
      .send(csv)
      .expect(202);
    const firstJob = first.body as { jobId: string; alreadyExists: boolean };
    expect(firstJob.jobId).toBeTruthy();
    expect(firstJob.alreadyExists).toBe(false);

    const second = await asOwner(http.post('/api/v1/imports'))
      .set('Idempotency-Key', key)
      .set('Content-Type', 'text/csv')
      .send(csv)
      .expect(202);
    const secondJob = second.body as { jobId: string; alreadyExists: boolean };
    expect(secondJob.jobId).toBe(firstJob.jobId);
    expect(secondJob.alreadyExists).toBe(true);

    const job = await asOwner(http.get(`/api/v1/imports/${firstJob.jobId}`)).expect(200);
    expect((job.body as { id: string }).id).toBe(firstJob.jobId);
  });

  it('sensitive erase: the owner may erase a contact; an unprivileged agent may not', async () => {
    const contact = (await asOwner(http.post('/api/v1/contacts')).send({ firstName: 'Pat', emails: ['pat@x.test'] }).expect(201))
      .body as { id: string; version: number };
    // Agent without contact.erase → 403 at the guard.
    const key = await provisionAgentKey(['contact.read']);
    await http
      .post(`/api/v1/contacts/${contact.id}/erasure`)
      .set('x-api-key', key)
      .send({ expectedVersion: contact.version })
      .expect(403);
    // Owner holds contact.erase → 204.
    await asOwner(http.post(`/api/v1/contacts/${contact.id}/erasure`)).send({ expectedVersion: contact.version }).expect(204);
  });

  it('serves a valid OpenAPI 3.1 document that includes the CRM routes', async () => {
    const doc = (await http.get('/api/v1/openapi.json').expect(200)).body as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(doc.paths['/api/v1/accounts']).toBeDefined();
    expect(doc.paths['/api/v1/deals/{id}/stage-transitions']).toBeDefined();
  });
});
