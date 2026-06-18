import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { decodeJwt } from 'jose';
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
 * Phase 2 verification gates (CLAUDE.md §7). Runs the real app as the RLS-subject `app_user`
 * against throwaway Postgres + Redis, so registration's cross-context provisioning is exercised
 * through the actual tenant policies — not a superuser that would mask them.
 */
describe('auth (Phase 2 gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

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
    process.env.LOGIN_MAX_ATTEMPTS = '3';

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

  const register = (email: string) =>
    http
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery staple', displayName: 'Ada Lovelace', tokenDelivery: 'body' });

  it('auto-provisions org + workspace + Owner membership, consent=false, argon2id hash', async () => {
    const email = `owner-${randomUUID()}@example.com`;
    const res = await register(email);
    expect(res.status).toBe(201);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();

    const [org] = await admin`SELECT id, data_processing_consent FROM organizations WHERE created_by IN (SELECT id FROM users WHERE primary_email = ${email})`;
    expect(org?.data_processing_consent).toBe(false);
    const ws = await admin`SELECT id FROM workspaces WHERE organization_id = ${org!.id}`;
    expect(ws).toHaveLength(1);
    const mr = await admin`
      SELECT r.name FROM membership_roles mr
      JOIN memberships m ON m.id = mr.membership_id
      JOIN roles r ON r.id = mr.role_id
      WHERE m.organization_id = ${org!.id} AND m.workspace_id IS NULL`;
    expect(mr.map((r) => r.name)).toEqual(['Owner']);
    const [identity] = await admin`SELECT secret_hash FROM identities WHERE provider_subject = ${email}`;
    expect(String(identity?.secret_hash)).toMatch(/^\$argon2id\$/);
  });

  it('access token carries no permission claims (gate §7.5)', async () => {
    const res = await register(`claims-${randomUUID()}@example.com`);
    const claims = decodeJwt(res.body.access_token);
    expect(claims.sub).toBeTruthy();
    expect(claims.org).toBeTruthy();
    expect(claims.token_version).toBe(0);
    for (const k of ['permissions', 'roles', 'scope', 'perms']) {
      expect(claims[k]).toBeUndefined();
    }
  });

  it('writes the full event set atomically; a duplicate email rolls back (gate §7.6)', async () => {
    const email = `evt-${randomUUID()}@example.com`;
    await register(email);
    const events = await admin`
      SELECT event_type FROM domain_events
      WHERE organization_id IN (SELECT id FROM organizations WHERE created_by IN (SELECT id FROM users WHERE primary_email = ${email}))`;
    const types = events.map((e) => e.event_type);
    for (const t of ['UserRegistered', 'OrganizationProvisioned', 'WorkspaceCreated', 'OwnerMembershipGranted', 'RoleAssigned', 'SessionCreated']) {
      expect(types).toContain(t);
    }
    expect((await register(email)).status).toBe(409);
    const users = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    expect(users).toHaveLength(1); // the 409 tx rolled back — no orphan user
  });

  it('refresh rotates, and replay of a rotated token revokes the whole family', async () => {
    const email = `rot-${randomUUID()}@example.com`;
    const r1 = (await register(email)).body.refresh_token as string;

    const rot = await http.post('/api/v1/auth/refresh').send({ refreshToken: r1, tokenDelivery: 'body' });
    expect(rot.status).toBe(200);
    const r2 = rot.body.refresh_token as string;
    expect(r2).not.toBe(r1);

    // replay the consumed R1 → reuse detected
    expect((await http.post('/api/v1/auth/refresh').send({ refreshToken: r1, tokenDelivery: 'body' })).status).toBe(401);
    // family revoked → the legitimate R2 is now dead too
    expect((await http.post('/api/v1/auth/refresh').send({ refreshToken: r2, tokenDelivery: 'body' })).status).toBe(401);
  });

  it('login: uniform 401 for unknown user and wrong password; lockout after N failures', async () => {
    const email = `login-${randomUUID()}@example.com`;
    await register(email);

    const unknown = await http.post('/api/v1/auth/login').send({ email: `nobody-${randomUUID()}@example.com`, password: 'whatever-1234' });
    const wrong = await http.post('/api/v1/auth/login').send({ email, password: 'wrong-password-1234' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.code).toBe(wrong.body.code);

    const ok = await http.post('/api/v1/auth/login').send({ email, password: 'correct horse battery staple', tokenDelivery: 'body' });
    expect(ok.status).toBe(200);

    // exhaust the throttle (LOGIN_MAX_ATTEMPTS=3) for a fresh account
    const target = `lock-${randomUUID()}@example.com`;
    await register(target);
    let last = 0;
    for (let i = 0; i < 4; i += 1) {
      last = (await http.post('/api/v1/auth/login').send({ email: target, password: 'bad-password-1234' })).status;
    }
    expect(last).toBe(429);
  });
});
