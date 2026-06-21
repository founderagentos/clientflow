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
 * Phase 3 verification gate (CLAUDE.md §6/§7): "invited member joins; membership grants access,
 * absence denies it." Runs the real app as the RLS-subject `app_user` against throwaway Postgres
 * + Redis, so the invite → accept → membership flow is exercised through the actual tenant
 * policies and the SECURITY DEFINER accept-time lookup.
 */
describe('tenancy invitations (Phase 3 gate)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;
  let memberRoleId: string;

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
        },
      },
    );
    await execFileAsync(join(repoRoot, 'node_modules/.bin/tsx'), [join(repoRoot, 'db/seed/seed.ts')], {
      env: { ...process.env, DATABASE_URL: pg.getConnectionUri() },
    });

    const appUserUrl = new URL(pg.getConnectionUri());
    appUserUrl.username = 'app_user';
    appUserUrl.password = 'app_user_pw';

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = appUserUrl.toString();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    process.env.AUTH_COOKIE_SECURE = 'false';

    const { AppModule } = await import('../app.module');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(fastifyCookie);
    // A real gateway stamps x-correlation-id on the inbound request; mirror that so the
    // tenant-context middleware binds it into the ambient context (events require it).
    fastify.addHook('onRequest', (req, reply, done) => {
      const correlationId = (req.headers['x-correlation-id'] as string) ?? randomUUID();
      req.headers['x-correlation-id'] = correlationId;
      void reply.header('x-correlation-id', correlationId);
      done();
    });
    await app.init();
    await fastify.ready();
    http = request(fastify.server);

    const [memberRole] = await admin`
      SELECT id FROM roles WHERE name = 'Member' AND scope = 'workspace' AND organization_id IS NULL`;
    memberRoleId = memberRole!.id as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  const register = (email: string) =>
    http.post('/api/v1/auth/register').send({
      email,
      password: 'correct horse battery staple',
      displayName: 'Ada Lovelace',
      tokenDelivery: 'body',
    });

  /** Register an owner and return { token, workspaceId }. */
  const registerOwner = async () => {
    const email = `owner-${randomUUID()}@example.com`;
    const token = (await register(email)).body.access_token as string;
    const ws = await http
      .get('/api/v1/workspaces')
      .set('Authorization', `Bearer ${token}`);
    expect(ws.status).toBe(200);
    return { token, workspaceId: ws.body.workspaces[0].id as string };
  };

  it('completes invite → new-user accept → membership grants access; absence denies it', async () => {
    const owner = await registerOwner();
    const inviteeEmail = `bob-${randomUUID()}@example.com`;

    // Owner invites Bob to the workspace with the Member role.
    const invite = await http
      .post(`/api/v1/workspaces/${owner.workspaceId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: inviteeEmail, roleId: memberRoleId });
    expect(invite.status).toBe(201);
    const token = invite.body.token as string;
    expect(token).toBeTruthy();

    // Absence denies: an unrelated principal (own org) cannot see Org A's workspace → 404 (RLS).
    const strangerToken = (await register(`stranger-${randomUUID()}@example.com`)).body
      .access_token as string;
    const denied = await http
      .get(`/api/v1/workspaces/${owner.workspaceId}/members`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(denied.status).toBe(404);

    // New-user accept: creates the account + membership + role atomically and auto-logs-in.
    const accept = await http
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ password: 'another correct horse battery', displayName: 'Bob Member', tokenDelivery: 'body' });
    expect(accept.status).toBe(200);
    expect(accept.body.access_token).toBeTruthy();
    const bobToken = accept.body.access_token as string;

    // Membership grants access: Bob can now read the workspace's members and is among them.
    const members = await http
      .get(`/api/v1/workspaces/${owner.workspaceId}/members`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(members.status).toBe(200);
    const bob = await admin`SELECT id FROM users WHERE primary_email = ${inviteeEmail}`;
    expect(bob).toHaveLength(1);
    expect(members.body.members.map((m: { principalId: string }) => m.principalId)).toContain(
      bob[0]!.id,
    );

    // The lifecycle events were written.
    const events = await admin`
      SELECT event_type FROM domain_events
      WHERE aggregate_id = ${bob[0]!.id} OR event_type IN ('MemberInvited','InvitationAccepted','MembershipCreated')`;
    const types = events.map((e) => e.event_type);
    for (const t of ['MemberInvited', 'InvitationAccepted', 'MembershipCreated', 'UserRegistered']) {
      expect(types).toContain(t);
    }
  });

  it('lets an existing user accept without creating a duplicate account', async () => {
    const owner = await registerOwner();
    const email = `existing-${randomUUID()}@example.com`;
    const existingToken = (await register(email)).body.access_token as string;

    const invite = await http
      .post(`/api/v1/workspaces/${owner.workspaceId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email, roleId: memberRoleId });
    const token = invite.body.token as string;

    const accept = await http
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Authorization', `Bearer ${existingToken}`)
      .send({});
    expect(accept.status).toBe(200);
    expect(accept.body.newUser).toBe(false);

    const users = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    expect(users).toHaveLength(1); // no duplicate
  });

  it('rejects accepting a revoked invitation', async () => {
    const owner = await registerOwner();
    const invite = await http
      .post(`/api/v1/workspaces/${owner.workspaceId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: `rev-${randomUUID()}@example.com`, roleId: memberRoleId });
    const { token, invitationId } = invite.body as { token: string; invitationId: string };

    const revoke = await http
      .delete(`/api/v1/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(revoke.status).toBe(204);

    const accept = await http
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ password: 'another correct horse battery', displayName: 'Late Bob', tokenDelivery: 'body' });
    expect(accept.status).toBe(404); // revoked → soft-deleted → not found
  });

  it('enforces optimistic locking on workspace update', async () => {
    const owner = await registerOwner();
    const created = await http
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Client A', slug: `client-a-${randomUUID().slice(0, 8)}` });
    expect(created.status).toBe(201);
    const { id, version } = created.body as { id: string; version: number };

    const stale = await http
      .patch(`/api/v1/workspaces/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Renamed', expectedVersion: version + 5 });
    expect(stale.status).toBe(409);
  });

  it('enforces the workspace nesting depth limit (≤ 3)', async () => {
    const owner = await registerOwner();
    const auth = { Authorization: `Bearer ${owner.token}` };
    const mk = (name: string, parentWorkspaceId?: string) =>
      http
        .post('/api/v1/workspaces')
        .set(auth)
        .send({ name, slug: `${name}-${randomUUID().slice(0, 8)}`, parentWorkspaceId });

    // owner.workspaceId is depth 1; child depth 2; grandchild depth 3; great-grandchild rejected.
    const child = await mk('child', owner.workspaceId);
    const grandchild = await mk('grandchild', child.body.id);
    expect(grandchild.status).toBe(201);
    const tooDeep = await mk('too-deep', grandchild.body.id);
    expect(tooDeep.status).toBe(409);
  });
});
