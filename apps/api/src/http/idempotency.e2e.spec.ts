import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import Redis from 'ioredis';
import request from 'supertest';

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd(), '../..');

/**
 * Phase 6 — Idempotency-Key handling (CLAUDE.md §6). Proves: an identical retry runs the side effect
 * once and replays the stored response; a key reused with a different body is rejected (422); an
 * in-flight duplicate is rejected (409); keys are tenant-scoped; no header means normal processing;
 * and the interceptor fails OPEN when the store is unavailable.
 */
describe('edge / idempotency (Phase 6)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let store: Redis;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;
  let redisUrl: string;

  let tokenA: string;
  let tokenB: string;
  let emailA: string;

  const bearer = (token: string) => (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  const register = (email: string) =>
    http.post('/api/v1/auth/register').send({
      email,
      password: 'correct horse battery staple',
      displayName: 'Ada Lovelace',
      tokenDelivery: 'body',
    });

  async function buildApp(): Promise<{ app: NestFastifyApplication; http: ReturnType<typeof request> }> {
    const { AppModule } = await import('../app.module');
    const created = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    created.setGlobalPrefix('api/v1');
    const fastify = created.getHttpAdapter().getInstance();
    await fastify.register(fastifyCookie);
    fastify.addHook('onRequest', (req, reply, done) => {
      void reply.header('x-correlation-id', (req.headers['x-correlation-id'] as string) ?? randomUUID());
      done();
    });
    await created.init();
    await fastify.ready();
    return { app: created, http: request(fastify.server) };
  }

  async function identity(email: string): Promise<{ principalId: string; organizationId: string }> {
    const [u] = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    const [o] = await admin`SELECT id FROM organizations WHERE created_by = ${u!.id as string}`;
    return { principalId: u!.id as string, organizationId: o!.id as string };
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
    redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = appUserUrl.toString();
    process.env.EVENT_RELAY_DATABASE_URL = relayUrl.toString();
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_COOKIE_SECURE = 'false';
    // Pin a signing keypair so tokens stay valid across the second (degraded) app instance built in
    // the fail-open test; otherwise each app boots a fresh ephemeral key and rejects the token.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    store = new Redis(redisUrl);
    ({ app, http } = await buildApp());

    emailA = `idem-a-${randomUUID()}@example.com`;
    tokenA = (await register(emailA)).body.access_token as string;
    tokenB = (await register(`idem-b-${randomUUID()}@example.com`)).body.access_token as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    store?.disconnect();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  const createRole = (token: string, key: string, body: { name: string; scope: string }) =>
    bearer(token)(http.post('/api/v1/roles')).set('Idempotency-Key', key).send(body);

  it('runs the side effect once and replays the stored response on retry', async () => {
    const name = `role-${randomUUID()}`;
    const key = randomUUID();
    const first = await createRole(tokenA, key, { name, scope: 'workspace' });
    expect(first.status).toBe(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const second = await createRole(tokenA, key, { name, scope: 'workspace' });
    expect(second.status).toBe(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);

    const { organizationId } = await identity(emailA);
    const rows = await admin`
      SELECT count(*)::int AS count FROM roles
      WHERE name = ${name} AND organization_id = ${organizationId}`;
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('rejects the same key reused with a different request body (422)', async () => {
    const key = randomUUID();
    expect((await createRole(tokenA, key, { name: `r-${randomUUID()}`, scope: 'workspace' })).status).toBe(201);
    const conflict = await createRole(tokenA, key, { name: `r-${randomUUID()}`, scope: 'workspace' });
    expect(conflict.status).toBe(422);
    expect(conflict.body).toMatchObject({ code: 'idempotency_key_reused' });
  });

  it('rejects an in-flight duplicate with 409', async () => {
    const key = randomUUID();
    const body = { name: `r-${randomUUID()}`, scope: 'workspace' };
    const { principalId, organizationId } = await identity(emailA);
    const fingerprint = createHash('sha256')
      .update(`POST\n/api/v1/roles\n${JSON.stringify(body)}`)
      .digest('hex');
    // Simulate a concurrent request still running by seeding the in-flight lock with that fingerprint.
    await store.set(
      `idem:${organizationId}:${principalId}:${key}`,
      JSON.stringify({ state: 'in_flight', fingerprint }),
      'EX',
      60,
    );
    const res = await createRole(tokenA, key, body);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'request_in_progress' });
  });

  it('scopes keys per principal/organization', async () => {
    const key = randomUUID();
    const a = await createRole(tokenA, key, { name: `r-${randomUUID()}`, scope: 'workspace' });
    const b = await createRole(tokenB, key, { name: `r-${randomUUID()}`, scope: 'workspace' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201); // different principal+org → independent key namespace, not a replay
    expect(b.headers['idempotency-replayed']).toBeUndefined();
  });

  it('processes normally when no Idempotency-Key is sent', async () => {
    const res = await bearer(tokenA)(http.post('/api/v1/roles')).send({
      name: `r-${randomUUID()}`,
      scope: 'workspace',
    });
    expect(res.status).toBe(201);
    expect(res.headers['idempotency-replayed']).toBeUndefined();
  });

  it('fails open when the idempotency store is unavailable', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const degraded = await buildApp();
    try {
      const res = await bearer(tokenA)(degraded.http.post('/api/v1/roles'))
        .set('Idempotency-Key', randomUUID())
        .send({ name: `r-${randomUUID()}`, scope: 'workspace' });
      expect(res.status).toBe(201); // store down → handler runs un-deduplicated, no 5xx
    } finally {
      await degraded.app.close();
      process.env.REDIS_URL = redisUrl;
    }
  });
});
