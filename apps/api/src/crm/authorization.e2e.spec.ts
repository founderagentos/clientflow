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
import { AccountService } from '@agentos/crm-account';
import { DealService, type DealActor } from '@agentos/crm-deal';

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd(), '../..');

/**
 * RFC-002 Phase 5 gate: Authorization + service-account parity. Drives the deal service directly (no
 * HTTP — Phase 6) through the real PDP-backed AUTHORIZATION adapter. Proves: default-deny (a principal
 * lacking the permission is rejected); ownership narrowing (a non-manager Salesperson sees/edits only
 * its own deals, a manager sees all); and service-account parity (an agent is authorized through the
 * same PDP and recorded as the actor).
 */
describe('CRM authorization (Phase 5 gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let deals: DealService;
  let accountsSvc: AccountService;
  let ownerToken: string;
  let workspaceId: string;
  let organizationId: string;
  let ownerActor: DealActor;
  let salesActor: DealActor; // a service_account with deal.read/create/update (no delete → non-manager)
  let noPermActor: DealActor; // a service_account with no deal permissions

  const asOwner = (r: request.Test) => r.set('Authorization', `Bearer ${ownerToken}`);

  async function provisionAgent(permissions: string[]): Promise<string> {
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
    return sa.serviceAccountId; // a service account IS a principal (shared PK)
  }

  const actorFor = (principalId: string, type: 'user' | 'service_account'): DealActor => ({
    principalId,
    organizationId,
    workspaceId,
    correlationId: randomUUID(),
    principalType: type,
  });

  const eventActor = async (aggregateId: string, type: string): Promise<string | null> => {
    const [row] = await admin`
      SELECT actor_principal_id FROM domain_events
      WHERE aggregate_id = ${aggregateId} AND event_type = ${type} LIMIT 1`;
    return (row?.actor_principal_id as string | undefined) ?? null;
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
    const ownerPrincipalId = user!.id as string;
    const [org] = await admin`SELECT id FROM organizations WHERE created_by = ${ownerPrincipalId}`;
    organizationId = org!.id as string;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${organizationId}`;
    workspaceId = ws!.id as string;

    deals = app.get(DealService, { strict: false });
    accountsSvc = app.get(AccountService, { strict: false });
    ownerActor = actorFor(ownerPrincipalId, 'user'); // Owner role = every CRM perm ⇒ manager
    salesActor = actorFor(await provisionAgent(['deal.read', 'deal.create', 'deal.update']), 'service_account');
    noPermActor = actorFor(await provisionAgent(['role.read']), 'service_account');

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

  // Account creation by the owner (a manager) — gives deals a valid account_id.
  const newAccountId = async (): Promise<string> => {
    const account = await accountsSvc.create(ownerActor, { name: `Acct ${randomUUID()}` });
    return account.id;
  };

  it('default-deny: a principal without deal.create is rejected', async () => {
    const accountId = await newAccountId();
    await expect(deals.create(noPermActor, { accountId })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('ownership: a non-manager Salesperson can act on its own deal but not another principal’s', async () => {
    const accountId = await newAccountId();
    const ownerDeal = await deals.create(ownerActor, { accountId }); // owner = Owner principal

    // Salesperson cannot read/update a deal it does not own (and is not a manager of).
    await expect(deals.get(salesActor, ownerDeal.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      deals.update(salesActor, ownerDeal.id, ownerDeal.version, { amount: '1.00' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Its own deal: fully usable.
    const salesDeal = await deals.create(salesActor, { accountId }); // owner defaults to the SA
    await deals.get(salesActor, salesDeal.id);
    await deals.update(salesActor, salesDeal.id, salesDeal.version, { amount: '2.00' });

    // List is narrowed to own for the Salesperson, unrestricted for the Owner (manager).
    const salesList = (await deals.list(salesActor, { limit: 50 })).map((d) => d.id);
    expect(salesList).toContain(salesDeal.id);
    expect(salesList).not.toContain(ownerDeal.id);
    const ownerList = (await deals.list(ownerActor, { limit: 50 })).map((d) => d.id);
    expect(ownerList).toEqual(expect.arrayContaining([ownerDeal.id, salesDeal.id]));
  });

  it('service-account parity: an agent is authorized via the same PDP and recorded as the actor', async () => {
    const accountId = await newAccountId();
    const saDeal = await deals.create(salesActor, { accountId });
    // The agent's principal id is the recorded actor on the emitted event (gate §13.3 / §3.2).
    expect(await eventActor(saDeal.id, 'DealCreated')).toBe(salesActor.principalId);
  });
});
