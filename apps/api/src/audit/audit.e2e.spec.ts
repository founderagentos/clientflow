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
import {
  DATABASE,
  withTenantTransaction,
  type Database,
} from '@agentos/persistence-kernel';
import { OutboxWriter, RelayWorker } from '@agentos/event-backbone';

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
 * Phase 5 verification gates (CLAUDE.md §7): a committed state change emits exactly one event that
 * the relay delivers to the append-only audit trail, and a rolled-back one emits nothing (§7.6);
 * the actor recorded is the human or the service account that acted (§7.3); re-delivery is
 * idempotent (at-least-once); and the audit query is RLS-isolated (§7.1) behind `audit.read`
 * (§7.2). Runs the real app as the RLS-subject `app_user`, with the relay on the privileged
 * `event_relay` connection, against throwaway Postgres + Redis.
 */
describe('audit + event backbone (Phase 5 gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let ownerToken: string;
  let ownerBToken: string;
  let orgA: string;
  let orgB: string;
  let workspaceA: string;
  let principalA: string;

  const bearer = (token: string) => (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  let asOwner: (r: request.Test) => request.Test;

  const register = (email: string) =>
    http.post('/api/v1/auth/register').send({
      email,
      password: 'correct horse battery staple',
      displayName: 'Ada Lovelace',
      tokenDelivery: 'body',
    });

  async function provisionAgent(
    permissions: string[],
  ): Promise<{ saId: string; apiKey: string }> {
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
        workspaceId: workspaceA,
        roleId: role.roleId,
      })
    ).body as { serviceAccountId: string };
    const key = (
      await asOwner(http.post(`/api/v1/service-accounts/${sa.serviceAccountId}/api-keys`)).send({})
    ).body as { apiKey: string };
    return { saId: sa.serviceAccountId, apiKey: key.apiKey };
  }

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

    const emailA = `owner-a-${randomUUID()}@example.com`;
    ownerToken = (await register(emailA)).body.access_token as string;
    const emailB = `owner-b-${randomUUID()}@example.com`;
    ownerBToken = (await register(emailB)).body.access_token as string;
    asOwner = bearer(ownerToken);

    const [userA] = await admin`SELECT id FROM users WHERE primary_email = ${emailA}`;
    principalA = userA!.id as string;
    const [org] = await admin`SELECT id FROM organizations WHERE created_by = ${principalA}`;
    orgA = org!.id as string;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${orgA}`;
    workspaceA = ws!.id as string;
    const [userB] = await admin`SELECT id FROM users WHERE primary_email = ${emailB}`;
    const [orgBRow] = await admin`SELECT id FROM organizations WHERE created_by = ${userB!.id as string}`;
    orgB = orgBRow!.id as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('relays a committed event to the append-only audit trail with the acting human as actor (gates §7.6/§7.3)', async () => {
    const row = await waitFor(async () => {
      const [entry] = await admin`
        SELECT actor_principal_id, source_event_id FROM audit_log_entries
        WHERE organization_id = ${orgA} AND action = 'register' AND resource_type = 'user'`;
      return entry ?? null;
    });
    expect(row.actor_principal_id).toBe(principalA);

    // The originating outbox row is marked delivered. The audit entry commits on the app_user
    // connection a beat before the relay's event_relay transaction commits the `published` mark,
    // so poll for it (eventual, at-least-once delivery — never lost).
    const evt = await waitFor(async () => {
      const [r] = await admin`
        SELECT status, published_at FROM domain_events WHERE id = ${row.source_event_id as string}`;
      return r && r.status === 'published' ? r : null;
    });
    expect(evt.published_at).not.toBeNull();
  });

  it('emits no event when the writing transaction rolls back (gate §7.6)', async () => {
    const db = app.get<Database>(DATABASE, { strict: false });
    const writer = app.get(OutboxWriter, { strict: false });
    const [before] = await admin`SELECT count(*)::int AS n FROM domain_events`;

    await expect(
      withTenantTransaction(db, { organizationId: orgA, workspaceId: null }, async (tx) => {
        await writer.append(tx, {
          organizationId: orgA,
          workspaceId: null,
          aggregateType: 'User',
          aggregateId: principalA,
          type: 'UserRegistered',
          actorPrincipalId: principalA,
          correlationId: randomUUID(),
          causationId: null,
          payload: { rolledBack: true },
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const [after] = await admin`SELECT count(*)::int AS n FROM domain_events`;
    expect(Number(after!.n)).toBe(Number(before!.n));
  });

  it('records a service account as the actor in the audit trail (gate §7.3)', async () => {
    const agent = await provisionAgent(['role.read', 'role.create']);
    const created = await http
      .post('/api/v1/roles')
      .set('X-Api-Key', agent.apiKey)
      .send({ name: `agent-made-${randomUUID()}`, scope: 'workspace' });
    expect(created.status).toBe(201);
    const roleId = created.body.roleId as string;

    const row = await waitFor(async () => {
      const [entry] = await admin`
        SELECT actor_principal_id FROM audit_log_entries
        WHERE resource_type = 'role' AND action = 'create' AND resource_id = ${roleId}`;
      return entry ?? null;
    });
    expect(row.actor_principal_id).toBe(agent.saId);
  });

  it('does not duplicate the audit entry when an event is re-delivered (idempotency)', async () => {
    // Pick a delivered event, reset it to pending, and force the relay to publish it again.
    const [target] = await admin`
      SELECT source_event_id FROM audit_log_entries
      WHERE organization_id = ${orgA} AND source_event_id IS NOT NULL LIMIT 1`;
    const eventId = target!.source_event_id as string;

    await admin`UPDATE domain_events SET published_at = NULL, status = 'pending' WHERE id = ${eventId}`;
    await app.get(RelayWorker, { strict: false }).tick();

    const [countRow] = await admin`
      SELECT count(*)::int AS n FROM audit_log_entries WHERE source_event_id = ${eventId}`;
    expect(Number(countRow!.n)).toBe(1);
  });

  it('returns only the caller organization’s entries, behind audit.read (gates §7.1/§7.2)', async () => {
    // Owner A sees only Org A's trail (RLS).
    const pageA = await asOwner(http.get('/api/v1/audit-log-entries')).query({ limit: 100 });
    expect(pageA.status).toBe(200);
    expect(pageA.body.entries.length).toBeGreaterThan(0);
    expect(
      (pageA.body.entries as Array<{ organizationId: string }>).every((e) => e.organizationId === orgA),
    ).toBe(true);

    // Owner B sees only Org B's trail — never Org A's.
    const pageB = await bearer(ownerBToken)(http.get('/api/v1/audit-log-entries')).query({ limit: 100 });
    expect(pageB.status).toBe(200);
    expect(
      (pageB.body.entries as Array<{ organizationId: string }>).every((e) => e.organizationId === orgB),
    ).toBe(true);

    // A principal without audit.read is denied; granting it allows the read (default-deny PDP).
    const noGrant = await provisionAgent(['role.read']);
    expect((await http.get('/api/v1/audit-log-entries').set('X-Api-Key', noGrant.apiKey)).status).toBe(403);
    const reader = await provisionAgent(['audit.read']);
    expect((await http.get('/api/v1/audit-log-entries').set('X-Api-Key', reader.apiKey)).status).toBe(200);
  });
});
