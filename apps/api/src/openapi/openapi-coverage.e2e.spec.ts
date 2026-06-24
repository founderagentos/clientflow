import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildOpenApiDocument } from './openapi.builder';
import { API_ROUTES } from './routes';

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd(), '../..');

// The OpenAPI meta endpoints document themselves; they are intentionally not in the registry.
const EXCLUDED_PATHS = new Set(['/api/v1/openapi.json', '/api/v1/docs']);
const DOCUMENTED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

/** Recursively collect every $ref string in a JSON value. */
function collectRefs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

function resolveRef(doc: Record<string, unknown>, ref: string): unknown {
  const parts = ref.replace(/^#\//, '').split('/');
  let node: unknown = doc;
  for (const part of parts) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * Phase 6 — OpenAPI 3.1 coverage / drift guard (CLAUDE.md §6). Boots the real app, enumerates the
 * live Nest+Fastify routes, and asserts the route registry matches them exactly (no undocumented
 * route, no orphan descriptor), the assembled document is valid 3.1 with resolvable refs, and every
 * operation references the shared Problem Details responses.
 */
describe('openapi / coverage (Phase 6)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  const liveRoutes: { method: string; url: string }[] = [];

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

    const { AppModule } = await import('../app.module');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) liveRoutes.push({ method, url: route.url });
    });
    await app.init();
    await fastify.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('documents every live route and has no orphan descriptors', () => {
    const live = new Set(
      liveRoutes
        .filter((r) => DOCUMENTED_METHODS.has(r.method) && !EXCLUDED_PATHS.has(r.url))
        .map((r) => `${r.method} ${r.url}`),
    );
    const documented = new Set(API_ROUTES.map((r) => `${r.method.toUpperCase()} ${r.path}`));

    const undocumented = [...live].filter((r) => !documented.has(r)).sort();
    const orphans = [...documented].filter((r) => !live.has(r)).sort();

    expect(undocumented, `undocumented live routes: ${undocumented.join(', ')}`).toEqual([]);
    expect(orphans, `descriptors with no live route: ${orphans.join(', ')}`).toEqual([]);
  });

  it('assembles a valid OpenAPI 3.1 document whose refs all resolve', () => {
    const doc = buildOpenApiDocument(API_ROUTES);
    expect(String(doc.openapi)).toMatch(/^3\.1\./);
    expect(doc.info).toBeDefined();

    for (const ref of collectRefs(doc)) {
      expect(resolveRef(doc, ref), `unresolved ref ${ref}`).toBeDefined();
    }
  });

  it('references the shared Problem Details responses on every operation', () => {
    const doc = buildOpenApiDocument(API_ROUTES) as { paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>> };
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const refs = Object.values(op.responses)
          .map((r) => r.$ref)
          .filter((v): v is string => typeof v === 'string');
        expect(
          refs.some((r) => r.includes('/responses/Problem')),
          `${method} ${path} has no problem responses`,
        ).toBe(true);
        // Rate-limit (429) and internal-error (500) are universal.
        expect(op.responses['429']).toMatchObject({ $ref: '#/components/responses/Problem429' });
        expect(op.responses['500']).toMatchObject({ $ref: '#/components/responses/Problem500' });
      }
    }
  });
});
