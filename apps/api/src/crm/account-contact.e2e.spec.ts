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
import { CrmEventType } from '@agentos/contracts';
import {
  AccountService,
  ContactService,
  AccountContactService,
  type CrmActor,
} from '@agentos/crm-account';

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
 * RFC-002 Phase 2 gate: Account + Contact + relationship. Exercises the module services directly
 * (no HTTP yet — controllers are Phase 6) against the real app booted as the RLS-subject `app_user`,
 * with the relay on the `event_relay` connection, over throwaway Postgres + Redis. Proves: every
 * write emits exactly one event atomically (a rolled-back write drops it); the open-Deal guard;
 * optimistic lock; the ≤1-primary invariant; and PII erasure leaving a valid tombstone.
 */
describe('CRM account + contact (Phase 2 gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let accounts: AccountService;
  let contacts: ContactService;
  let links: AccountContactService;
  let actor: CrmActor;

  const eventCount = async (aggregateId: string, type: string): Promise<number> => {
    const [row] = await admin`
      SELECT count(*)::int AS n FROM domain_events
      WHERE aggregate_id = ${aggregateId} AND event_type = ${type}`;
    return Number(row!.n);
  };

  const makeContact = () =>
    contacts.create(actor, { firstName: 'Grace', lastName: 'Hopper', emails: ['grace@example.com'] });

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

    accounts = app.get(AccountService, { strict: false });
    contacts = app.get(ContactService, { strict: false });
    links = app.get(AccountContactService, { strict: false });
    actor = {
      principalId,
      organizationId: org!.id as string,
      workspaceId: ws!.id as string,
      correlationId: randomUUID(),
    };
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end({ timeout: 5 });
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('emits exactly one AccountCreated atomically, audited with the acting principal', async () => {
    const account = await accounts.create(actor, { name: 'Initech', domain: 'INITECH.com' });
    expect(await eventCount(account.id, CrmEventType.AccountCreated)).toBe(1);
    // domain normalized to lowercase (dedup signal).
    expect(account.domain).toBe('initech.com');

    const entry = await waitFor(async () => {
      const [row] = await admin`
        SELECT actor_principal_id, action, resource_type FROM audit_log_entries
        WHERE resource_id = ${account.id} AND action = 'create' AND resource_type = 'account'`;
      return row ?? null;
    });
    expect(entry.actor_principal_id).toBe(actor.principalId);
  });

  it('optimistic lock: a stale-version update is rejected and emits no event', async () => {
    const account = await accounts.create(actor, { name: 'Acme' });
    const before = await eventCount(account.id, CrmEventType.AccountUpdated);
    await expect(
      accounts.update(actor, account.id, account.version + 99, { name: 'Acme Corp' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    expect(await eventCount(account.id, CrmEventType.AccountUpdated)).toBe(before);
  });

  it('open-Deal guard blocks deletion; with no open deals it soft-deletes and emits one event', async () => {
    const account = await accounts.create(actor, { name: 'Globex' });
    await expect(
      accounts.archive(actor, { id: account.id, expectedVersion: account.version, openDealCount: 1 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Still present, no delete event.
    await expect(accounts.get(actor, account.id)).resolves.toMatchObject({ id: account.id });
    expect(await eventCount(account.id, CrmEventType.AccountDeleted)).toBe(0);

    await accounts.archive(actor, {
      id: account.id,
      expectedVersion: account.version,
      openDealCount: 0,
    });
    await expect(accounts.get(actor, account.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await eventCount(account.id, CrmEventType.AccountDeleted)).toBe(1);
  });

  it('relationship: link / set-primary / unlink each emit one event; ≤1 primary per account', async () => {
    const account = await accounts.create(actor, { name: 'Umbrella' });
    const c1 = await makeContact();
    const c2 = await makeContact();

    await links.link(actor, { accountId: account.id, contactId: c1.id, isPrimary: true });
    await links.link(actor, { accountId: account.id, contactId: c2.id, isPrimary: true });
    expect(await eventCount(account.id, CrmEventType.AccountContactLinked)).toBe(2);

    // Linking c2 as primary demoted c1 — exactly one active primary, and it is c2.
    const primaries = await admin`
      SELECT contact_id FROM account_contacts
      WHERE account_id = ${account.id} AND is_primary = true AND deleted_at IS NULL`;
    expect(primaries.map((r) => r.contact_id)).toEqual([c2.id]);

    await links.setPrimary(actor, account.id, c1.id);
    expect(await eventCount(account.id, CrmEventType.AccountPrimaryContactChanged)).toBe(1);
    const afterSet = await admin`
      SELECT contact_id FROM account_contacts
      WHERE account_id = ${account.id} AND is_primary = true AND deleted_at IS NULL`;
    expect(afterSet.map((r) => r.contact_id)).toEqual([c1.id]);

    await links.unlink(actor, account.id, c2.id);
    expect(await eventCount(account.id, CrmEventType.AccountContactUnlinked)).toBe(1);
  });

  it('erasure purges PII and leaves a referentially-valid tombstone + ContactErased', async () => {
    const account = await accounts.create(actor, { name: 'Soylent' });
    const contact = await contacts.create(actor, {
      firstName: 'Eve',
      lastName: 'Polastri',
      emails: ['eve@example.com'],
      phones: ['+15551234567'],
      title: 'VP',
      customFields: { ssn: 'secret' },
    });
    await links.link(actor, { accountId: account.id, contactId: contact.id });

    await contacts.erase(actor, contact.id, contact.version);
    expect(await eventCount(contact.id, CrmEventType.ContactErased)).toBe(1);

    const [row] = await admin`
      SELECT first_name, last_name, title, emails, phones, primary_email_normalized,
             custom_fields, erased_at, deleted_at
      FROM contacts WHERE id = ${contact.id}`;
    expect(row!.first_name).toBeNull();
    expect(row!.last_name).toBeNull();
    expect(row!.title).toBeNull();
    expect(row!.emails).toEqual([]);
    expect(row!.phones).toEqual([]);
    expect(row!.primary_email_normalized).toBeNull();
    expect(row!.custom_fields).toEqual({});
    expect(row!.erased_at).not.toBeNull();
    // Tombstone: the row is NOT soft-deleted and its link survives (structural validity).
    expect(row!.deleted_at).toBeNull();
    const [link] = await admin`
      SELECT 1 FROM account_contacts
      WHERE account_id = ${account.id} AND contact_id = ${contact.id} AND deleted_at IS NULL`;
    expect(link).toBeTruthy();
  });

  it('normalizes the primary email and cascade-soft-deletes links on account archive', async () => {
    const contact = await contacts.create(actor, { emails: ['Ada@Example.COM'] });
    const [normalized] = await admin`
      SELECT primary_email_normalized FROM contacts WHERE id = ${contact.id}`;
    expect(normalized!.primary_email_normalized).toBe('ada@example.com');

    const account = await accounts.create(actor, { name: 'Hooli' });
    await links.link(actor, { accountId: account.id, contactId: contact.id });
    await accounts.archive(actor, {
      id: account.id,
      expectedVersion: account.version,
      openDealCount: 0,
    });

    // Cascade: the link is soft-deleted with the account; the contact row remains.
    const active = await admin`
      SELECT 1 FROM account_contacts WHERE account_id = ${account.id} AND deleted_at IS NULL`;
    expect(active).toHaveLength(0);
    await expect(contacts.get(actor, contact.id)).resolves.toMatchObject({ id: contact.id });
  });
});
