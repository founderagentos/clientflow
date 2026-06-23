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
 * Phase 4 verification gates (CLAUDE.md §7): default-deny authorization (§7.2), service accounts
 * authorized through the *same* PDP and attributed as the actor (§7.3), cross-tenant 404 (§7.4 /
 * §3.8), and revocation taking effect within one token TTL (§7.5). Runs the real app as the
 * RLS-subject `app_user` against throwaway Postgres + Redis so the PDP, RLS, and the Redis
 * permission cache are all exercised for real.
 */
describe('access / PDP (Phase 4 gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let ownerToken: string;
  let ownerBToken: string;
  let orgA: string;
  let workspaceA: string;
  let ownerMembershipA: string;
  let ownerRoleId: string;
  let ownerRoleVersion: number;

  const bearer = (token: string) => (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  let asOwner: (r: request.Test) => request.Test;

  const register = (email: string) =>
    http.post('/api/v1/auth/register').send({
      email,
      password: 'correct horse battery staple',
      displayName: 'Ada Lovelace',
      tokenDelivery: 'body',
    });

  /** Create a custom role with the given permissions, a service account holding it, and a key. */
  async function provisionAgent(
    permissions: string[],
  ): Promise<{ saId: string; membershipId: string; roleId: string; apiKey: string }> {
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
    ).body as { serviceAccountId: string; membershipId: string };
    const key = (
      await asOwner(http.post(`/api/v1/service-accounts/${sa.serviceAccountId}/api-keys`)).send({})
    ).body as { apiKey: string };
    return { saId: sa.serviceAccountId, membershipId: sa.membershipId, roleId: role.roleId, apiKey: key.apiKey };
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
    ownerBToken = (await register(`owner-b-${randomUUID()}@example.com`)).body.access_token as string;
    asOwner = bearer(ownerToken);

    const [org] = await admin`
      SELECT id FROM organizations
      WHERE created_by IN (SELECT id FROM users WHERE primary_email = ${emailA})`;
    orgA = org!.id as string;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${orgA}`;
    workspaceA = ws!.id as string;
    const [m] = await admin`
      SELECT id FROM memberships WHERE organization_id = ${orgA} AND workspace_id IS NULL`;
    ownerMembershipA = m!.id as string;
    const [role] = await admin`
      SELECT id, version FROM roles
      WHERE name = 'Owner' AND organization_id IS NULL AND deleted_at IS NULL`;
    ownerRoleId = role!.id as string;
    ownerRoleVersion = Number(role!.version);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('default-denies a principal with no grant, and a service account flows through the same PDP (gates §7.2/§7.3)', async () => {
    // A service account with no role/membership has no grants → denied.
    const sa = (
      await asOwner(http.post('/api/v1/service-accounts')).send({
        name: `sa-${randomUUID()}`,
        kind: 'agent',
        workspaceId: workspaceA,
      })
    ).body as { serviceAccountId: string };
    const key = (
      await asOwner(http.post(`/api/v1/service-accounts/${sa.serviceAccountId}/api-keys`)).send({})
    ).body as { apiKey: string };
    const denied = await http.get('/api/v1/roles').set('X-Api-Key', key.apiKey);
    expect(denied.status).toBe(403);

    // An explicit grant (via the same PDP path) allows it.
    const agent = await provisionAgent(['role.read']);
    const allowed = await http.get('/api/v1/roles').set('X-Api-Key', agent.apiKey);
    expect(allowed.status).toBe(200);
  });

  it('records the service account as the actor in emitted events (gate §7.3)', async () => {
    const agent = await provisionAgent(['role.read', 'role.create']);
    const created = await http
      .post('/api/v1/roles')
      .set('X-Api-Key', agent.apiKey)
      .send({ name: `agent-made-${randomUUID()}`, scope: 'workspace' });
    expect(created.status).toBe(201);
    const madeRoleId = created.body.roleId as string;

    const [event] = await admin`
      SELECT actor_principal_id FROM domain_events
      WHERE event_type = 'RoleCreated' AND aggregate_id = ${madeRoleId}`;
    expect(event?.actor_principal_id).toBe(agent.saId);
  });

  it('revokes access within one token TTL — immediately on the next request (gate §7.5)', async () => {
    const agent = await provisionAgent(['role.read']);
    // Warm the permission cache.
    expect((await http.get('/api/v1/roles').set('X-Api-Key', agent.apiKey)).status).toBe(200);

    const revoke = await asOwner(
      http.delete(`/api/v1/memberships/${agent.membershipId}/roles/${agent.roleId}`),
    );
    expect(revoke.status).toBe(200);

    // Cache was invalidated on revoke (generation bump) — denied on the very next request.
    expect((await http.get('/api/v1/roles').set('X-Api-Key', agent.apiKey)).status).toBe(403);
  });

  it('revoking a permission from a role drops access for its holders on the next request', async () => {
    const agent = await provisionAgent(['role.read']);
    expect((await http.get('/api/v1/roles').set('X-Api-Key', agent.apiKey)).status).toBe(200);

    await asOwner(http.delete(`/api/v1/roles/${agent.roleId}/permissions/role.read`));
    expect((await http.get('/api/v1/roles').set('X-Api-Key', agent.apiKey)).status).toBe(403);
  });

  it('returns 404 (not 403) for a cross-tenant membership reference (gate §7.4/§3.8)', async () => {
    // Owner B (a different org) cannot see Org A's membership — assignment resolves to 404.
    const res = await bearer(ownerBToken)(
      http.post(`/api/v1/memberships/${ownerMembershipA}/roles`),
    ).send({ roleId: ownerRoleId });
    expect(res.status).toBe(404);
  });

  it('rejects mutation of a system role with 422 (gate §7.6)', async () => {
    const res = await asOwner(http.patch(`/api/v1/roles/${ownerRoleId}`)).send({
      name: 'Hacked',
      expectedVersion: ownerRoleVersion,
    });
    expect(res.status).toBe(422);
  });
});
