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
import { CrmEventType, DealEventType, LeadEventType, LeadStatus } from '@agentos/contracts';
import { AccountService, ContactService, type CrmActor } from '@agentos/crm-account';
import { DealService } from '@agentos/crm-deal';
import { LeadService } from '@agentos/crm-lead';
import { LeadConversionOrchestrator } from './lead-conversion.orchestrator';

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
 * RFC-002 Phase 4a gate: Lead + Conversion. Exercises the module services + the
 * `LeadConversionOrchestrator` directly (no HTTP — Phase 6) against the real app as `app_user`.
 * Proves: conversion is atomic (one event per produced entity, all-or-nothing) and **one-shot** — a
 * replay on an already-converted lead returns the prior ids and writes nothing new; dedup match
 * reuses an existing Account by normalized domain; an unqualified lead cannot be converted; and
 * merge soft-deletes the merged lead with `merged_into_lead_id` set.
 */
describe('CRM lead + conversion (Phase 4a gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let leads: LeadService;
  let accountsSvc: AccountService;
  let contactsSvc: ContactService;
  let deals: DealService;
  let orchestrator: LeadConversionOrchestrator;
  let actor: CrmActor;

  const eventCount = async (aggregateId: string, type: string): Promise<number> => {
    const [row] = await admin`
      SELECT count(*)::int AS n FROM domain_events
      WHERE aggregate_id = ${aggregateId} AND event_type = ${type}`;
    return Number(row!.n);
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

    const email = `owner-${randomUUID()}@example.com`;
    await http
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery staple', displayName: 'Ada Lovelace', tokenDelivery: 'body' })
      .expect(201);
    const [user] = await admin`SELECT id FROM users WHERE primary_email = ${email}`;
    const principalId = user!.id as string;
    const [org] = await admin`SELECT id FROM organizations WHERE created_by = ${principalId}`;
    const [ws] = await admin`SELECT id FROM workspaces WHERE organization_id = ${org!.id as string}`;
    const workspaceId = ws!.id as string;

    leads = app.get(LeadService, { strict: false });
    accountsSvc = app.get(AccountService, { strict: false });
    contactsSvc = app.get(ContactService, { strict: false });
    deals = app.get(DealService, { strict: false });
    orchestrator = app.get(LeadConversionOrchestrator, { strict: false });
    actor = { principalId, organizationId: org!.id as string, workspaceId, correlationId: randomUUID() };

    // Deal creation (inside conversion) resolves the default pipeline, which the WorkspaceCreated
    // consumer seeds asynchronously (Phase 1) — wait for it before any test runs.
    await waitFor(async () => {
      const [row] = await admin`
        SELECT id FROM pipelines WHERE workspace_id = ${workspaceId} AND is_default = true`;
      return row ?? null;
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('atomic happy path: converts a lead into a linked Account+Contact+Deal, one event each', async () => {
    const lead = await leads.create(actor, {
      name: 'Ada Lovelace',
      email: 'Ada@Example.COM',
      domain: 'example.com',
    });

    const result = await orchestrator.convert(actor, lead.id);
    expect(result.alreadyConverted).toBe(false);

    const account = await accountsSvc.get(actor, result.accountId);
    expect(account.domain).toBe('example.com');
    const contact = await contactsSvc.get(actor, result.contactId);
    expect(contact.primaryEmailNormalized).toBe('ada@example.com'); // normalized dedup signal
    const deal = await deals.get(actor, result.dealId);
    expect(deal.accountId).toBe(result.accountId);
    expect(deal.primaryContactId).toBe(result.contactId);

    const convertedLead = await leads.get(actor, lead.id);
    expect(convertedLead.convertedAt).not.toBeNull();
    expect(convertedLead.convertedAccountId).toBe(result.accountId);
    expect(convertedLead.convertedContactId).toBe(result.contactId);
    expect(convertedLead.convertedDealId).toBe(result.dealId);
    expect(convertedLead.status).toBe(LeadStatus.Qualified);

    expect(await eventCount(result.accountId, CrmEventType.AccountCreated)).toBe(1);
    expect(await eventCount(result.contactId, CrmEventType.ContactCreated)).toBe(1);
    expect(await eventCount(result.dealId, DealEventType.DealCreated)).toBe(1);
    expect(await eventCount(lead.id, LeadEventType.LeadConverted)).toBe(1);
  });

  it('one-shot replay (gate): converting an already-converted lead returns the same ids and writes nothing new', async () => {
    const lead = await leads.create(actor, {
      name: 'Grace Hopper',
      email: `grace-${randomUUID()}@navy.mil`,
      domain: `navy-${randomUUID()}.mil`,
    });
    const first = await orchestrator.convert(actor, lead.id);
    expect(first.alreadyConverted).toBe(false);

    const before = {
      account: await eventCount(first.accountId, CrmEventType.AccountCreated),
      contact: await eventCount(first.contactId, CrmEventType.ContactCreated),
      deal: await eventCount(first.dealId, DealEventType.DealCreated),
      converted: await eventCount(lead.id, LeadEventType.LeadConverted),
    };

    const replay = await orchestrator.convert(actor, lead.id);
    expect(replay.alreadyConverted).toBe(true);
    expect(replay.accountId).toBe(first.accountId);
    expect(replay.contactId).toBe(first.contactId);
    expect(replay.dealId).toBe(first.dealId);

    expect(await eventCount(first.accountId, CrmEventType.AccountCreated)).toBe(before.account);
    expect(await eventCount(first.contactId, CrmEventType.ContactCreated)).toBe(before.contact);
    expect(await eventCount(first.dealId, DealEventType.DealCreated)).toBe(before.deal);
    expect(await eventCount(lead.id, LeadEventType.LeadConverted)).toBe(before.converted);
  });

  it('dedup match: a second lead with the same domain reuses the Account but creates a new Contact + Deal', async () => {
    const domain = `dedup-${randomUUID()}.com`;
    const lead1 = await leads.create(actor, {
      name: 'Lead One',
      email: `one-${randomUUID()}@${domain}`,
      domain,
    });
    const r1 = await orchestrator.convert(actor, lead1.id);

    const lead2 = await leads.create(actor, {
      name: 'Lead Two',
      email: `two-${randomUUID()}@${domain}`,
      domain,
    });
    const r2 = await orchestrator.convert(actor, lead2.id);

    expect(r2.accountId).toBe(r1.accountId);
    expect(r2.contactId).not.toBe(r1.contactId);
    expect(r2.dealId).not.toBe(r1.dealId);
    expect(await eventCount(r1.accountId, CrmEventType.AccountCreated)).toBe(1);
  });

  it('convertibility guard: an unqualified lead cannot be converted', async () => {
    const lead = await leads.create(actor, { name: 'Bad Lead', domain: `bad-${randomUUID()}.com` });
    await leads.changeStatus(actor, lead.id, lead.version, LeadStatus.Unqualified);

    await expect(orchestrator.convert(actor, lead.id)).rejects.toMatchObject({ code: 'conflict' });

    const stillThere = await leads.get(actor, lead.id);
    expect(stillThere.convertedAt).toBeNull();
  });

  it('merge: the merged lead is soft-deleted and points at the survivor', async () => {
    const survivor = await leads.create(actor, { name: 'Survivor', domain: `merge-${randomUUID()}.com` });
    const merged = await leads.create(actor, { name: 'Merged Away', domain: `merge2-${randomUUID()}.com` });

    await leads.merge(actor, survivor.id, merged.id, merged.version);

    await expect(leads.get(actor, merged.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await eventCount(merged.id, LeadEventType.LeadsMerged)).toBe(1);

    const [row] = await admin`SELECT merged_into_lead_id, deleted_at FROM leads WHERE id = ${merged.id}`;
    expect(row!.merged_into_lead_id).toBe(survivor.id);
    expect(row!.deleted_at).not.toBeNull();
  });
});
