import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import Redis from 'ioredis';
import request from 'supertest';

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd(), '../..');

// Small, layer-distinct limits so each layer can be exercised in isolation. IP is comfortably above
// any single test's traffic (buckets are flushed before each test); principal/org bind at 5.
const IP_MAX = 15;
const LAYER_MAX = 5;

/**
 * Phase 6 — three-layer rate limiting (CLAUDE.md §6). Proves: per-IP limiting on unauthenticated
 * traffic with a 429 plus RateLimit and Retry-After headers; per-principal/per-organization buckets
 * are tenant-isolated; headers are emitted on success; and the limiter fails OPEN when Redis is down.
 */
describe('edge / rate limiting (Phase 6)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let flusher: Redis;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;
  let redisUrl: string;

  let tokenA: string;
  let tokenB: string;

  const bearer = (token: string) => (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  const register = (email: string) =>
    http.post('/api/v1/auth/register').send({
      email,
      password: 'correct horse battery staple',
      displayName: 'Ada Lovelace',
      tokenDelivery: 'body',
    });

  async function buildApp(
    bodyLimit?: number,
  ): Promise<{ app: NestFastifyApplication; http: ReturnType<typeof request> }> {
    const { AppModule } = await import('../app.module');
    const adapter = new FastifyAdapter(bodyLimit !== undefined ? { bodyLimit } : {});
    const created = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
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
    process.env.RATE_LIMIT_IP_MAX = String(IP_MAX);
    process.env.RATE_LIMIT_PRINCIPAL_MAX = String(LAYER_MAX);
    process.env.RATE_LIMIT_ORG_MAX = String(LAYER_MAX);

    flusher = new Redis(redisUrl);
    ({ app, http } = await buildApp());

    tokenA = (await register(`rl-a-${randomUUID()}@example.com`)).body.access_token as string;
    tokenB = (await register(`rl-b-${randomUUID()}@example.com`)).body.access_token as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    flusher?.disconnect();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  beforeEach(async () => {
    await flusher.flushall();
  });

  it('limits per-IP and returns 429 with RateLimit-*/Retry-After headers', async () => {
    for (let i = 0; i < IP_MAX; i++) {
      const res = await http.get('/api/v1/roles');
      expect(res.status).toBe(401); // under limit: passes rate-limit, denied by permission guard
    }
    const limited = await http.get('/api/v1/roles');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(limited.headers['content-type']).toContain('application/problem+json');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit-limit']).toBe(String(IP_MAX));
    expect(limited.headers['ratelimit-remaining']).toBe('0');
  });

  it('keeps per-principal/per-organization buckets tenant-isolated', async () => {
    for (let i = 0; i < LAYER_MAX; i++) {
      const ok = await bearer(tokenA)(http.get('/api/v1/roles'));
      expect(ok.status).toBe(200);
    }
    // Principal A's own bucket is exhausted.
    expect((await bearer(tokenA)(http.get('/api/v1/roles'))).status).toBe(429);
    // A different principal (different org) is unaffected — keys are per principal & per org.
    expect((await bearer(tokenB)(http.get('/api/v1/roles'))).status).toBe(200);
  });

  it('emits RateLimit-* headers on a successful response', async () => {
    const res = await bearer(tokenA)(http.get('/api/v1/roles'));
    expect(res.status).toBe(200);
    expect(Number(res.headers['ratelimit-limit'])).toBe(LAYER_MAX);
    expect(Number(res.headers['ratelimit-remaining'])).toBe(LAYER_MAX - 1);
    expect(Number(res.headers['ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('does not rate-limit the liveness probe', async () => {
    for (let i = 0; i < IP_MAX + 5; i++) {
      expect((await http.get('/api/v1/health')).status).toBeLessThan(429);
    }
  });

  it('rejects an oversized request body with a 413 problem document', async () => {
    const tiny = await buildApp(1024); // 1 KiB body limit
    try {
      const res = await tiny.http
        .post('/api/v1/auth/login')
        .set('content-type', 'application/json')
        .send({ email: 'a@example.com', password: 'x'.repeat(4096) });
      expect(res.status).toBe(413);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ code: 'payload_too_large', status: 413 });
    } finally {
      await tiny.app.close();
    }
  });

  it('fails open when the rate-limit store is unavailable', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1'; // connection refused
    const degraded = await buildApp();
    try {
      // Rate-limit Redis call rejects → guard allows → request reaches the permission guard (401).
      const res = await degraded.http.get('/api/v1/roles');
      expect(res.status).toBe(401);
    } finally {
      await degraded.app.close();
      process.env.REDIS_URL = redisUrl;
    }
  });
});
