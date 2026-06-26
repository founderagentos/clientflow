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
import { DealEventType } from '@agentos/contracts';
import { AccountService, type CrmActor } from '@agentos/crm-account';
import { DealService, PipelineService } from '@agentos/crm-deal';
import { AccountDeletionOrchestrator } from './account-deletion.orchestrator';

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
 * RFC-002 Phase 3 gate: Deal + Pipeline. Exercises the module services directly (no HTTP — Phase 6)
 * against the real app as `app_user`. Proves: an illegal transition is rejected; a legal one appends
 * `deal_stage_history` and emits `DealStageChanged`; optimistic-lock mismatch → 409; a terminal
 * transition records `DealWon`; `deal_stage_history` is append-only at the grant level (gate 7); the
 * board aggregation is correct; and the account delete guard now resolves the real open-deal count.
 */
describe('CRM deal + pipeline (Phase 3 gates)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let admin: Sql;
  let appUserSql: Sql;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof request>;

  let deals: DealService;
  let pipelines: PipelineService;
  let accountsSvc: AccountService;
  let orchestrator: AccountDeletionOrchestrator;
  let actor: CrmActor;

  let defaultPipelineId: string;
  let leadInId: string;
  let qualifiedId: string;
  let wonId: string;

  const eventCount = async (aggregateId: string, type: string): Promise<number> => {
    const [row] = await admin`
      SELECT count(*)::int AS n FROM domain_events
      WHERE aggregate_id = ${aggregateId} AND event_type = ${type}`;
    return Number(row!.n);
  };

  const newAccount = async (name = `Acct ${randomUUID()}`) =>
    accountsSvc.create(actor, { name });

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

    appUserSql = postgres(appUserUrl.toString(), { max: 1 });
    deals = app.get(DealService, { strict: false });
    pipelines = app.get(PipelineService, { strict: false });
    accountsSvc = app.get(AccountService, { strict: false });
    orchestrator = app.get(AccountDeletionOrchestrator, { strict: false });
    actor = { principalId, organizationId: org!.id as string, workspaceId, correlationId: randomUUID() };

    // The default pipeline is seeded asynchronously by the WorkspaceCreated consumer (Phase 1).
    const pipeline = await waitFor(async () => {
      const [row] = await admin`
        SELECT id FROM pipelines WHERE workspace_id = ${workspaceId} AND is_default = true`;
      return row ?? null;
    });
    defaultPipelineId = pipeline.id as string;
    const stageRows = await admin`
      SELECT id, position, category FROM pipeline_stages
      WHERE pipeline_id = ${defaultPipelineId} ORDER BY position`;
    leadInId = stageRows[0]!.id as string;
    qualifiedId = stageRows[1]!.id as string;
    wonId = stageRows.find((s) => s.category === 'won')!.id as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all([admin?.end({ timeout: 5 }), appUserSql?.end({ timeout: 5 })]);
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('rejects illegal transitions; a legal one appends history and emits one DealStageChanged', async () => {
    const account = await newAccount();
    const deal = await deals.create(actor, { accountId: account.id });
    expect(deal.stageId).toBe(leadInId); // created in the first open stage

    // Illegal: target stage in a DIFFERENT pipeline.
    const other = await pipelines.create(actor, {
      name: `Other ${randomUUID()}`,
      stages: [{ name: 'Other Open', probability: '0.10', category: 'open' }],
    });
    const otherBoard = await pipelines.getBoard(actor, other.id);
    await expect(
      deals.transition(actor, { dealId: deal.id, toStageId: otherBoard.stages[0]!.stageId, expectedVersion: deal.version }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // Illegal: into a won stage without a close reason.
    await expect(
      deals.transition(actor, { dealId: deal.id, toStageId: wonId, expectedVersion: deal.version }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // Legal: open → open.
    const moved = await deals.transition(actor, {
      dealId: deal.id,
      toStageId: qualifiedId,
      expectedVersion: deal.version,
    });
    expect(moved.stageId).toBe(qualifiedId);
    expect(await eventCount(deal.id, DealEventType.DealStageChanged)).toBe(1);

    const history = await admin`
      SELECT from_stage_id, to_stage_id, duration_in_previous_seconds FROM deal_stage_history
      WHERE deal_id = ${deal.id} ORDER BY entered_at`;
    // Initial (NULL → Lead In) + the transition (Lead In → Qualified).
    expect(history).toHaveLength(2);
    expect(history[1]!.from_stage_id).toBe(leadInId);
    expect(history[1]!.to_stage_id).toBe(qualifiedId);
    expect(Number(history[1]!.duration_in_previous_seconds)).toBeGreaterThanOrEqual(0);
  });

  it('optimistic-lock mismatch on transition → 409, no event', async () => {
    const account = await newAccount();
    const deal = await deals.create(actor, { accountId: account.id });
    const before = await eventCount(deal.id, DealEventType.DealStageChanged);
    await expect(
      deals.transition(actor, { dealId: deal.id, toStageId: qualifiedId, expectedVersion: deal.version + 99 }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    expect(await eventCount(deal.id, DealEventType.DealStageChanged)).toBe(before);
  });

  it('a terminal transition sets close fields and emits DealStageChanged + DealWon; reopen is rejected', async () => {
    const account = await newAccount();
    const created = await deals.create(actor, { accountId: account.id, amount: '5000.00', currency: 'USD' });
    const won = await deals.transition(actor, {
      dealId: created.id,
      toStageId: wonId,
      expectedVersion: created.version,
      closeReason: 'Signed contract',
    });
    expect(won.stageId).toBe(wonId);
    expect(won.closeReason).toBe('Signed contract');
    expect(won.closedAt).not.toBeNull();
    expect(await eventCount(created.id, DealEventType.DealStageChanged)).toBe(1);
    expect(await eventCount(created.id, DealEventType.DealWon)).toBe(1);

    // Terminal is terminal — no reopen.
    await expect(
      deals.transition(actor, { dealId: created.id, toStageId: qualifiedId, expectedVersion: won.version }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('deal_stage_history rejects UPDATE/DELETE at the grant level (gate 7, append-only)', async () => {
    // Set the tenant GUCs first so RLS can evaluate; the failure is then the grant denial (the table
    // has SELECT/INSERT only for app_user), not a missing-context error. Raw app_user connection
    // surfaces the Postgres error directly (no ORM wrapping).
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${actor.organizationId}', false)`);
    await appUserSql.unsafe(`SELECT set_config('app.current_workspace_id', '${actor.workspaceId}', false)`);
    await expect(
      appUserSql.unsafe('UPDATE deal_stage_history SET duration_in_previous_seconds = 0'),
    ).rejects.toThrow(/permission denied/i);
    await expect(appUserSql.unsafe('DELETE FROM deal_stage_history')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('board aggregation returns every stage with correct count + summed amount', async () => {
    const account = await newAccount();
    const pipeline = await pipelines.create(actor, {
      name: `Board ${randomUUID()}`,
      stages: [
        { name: 'Open A', probability: '0.20', category: 'open' },
        { name: 'Won', probability: '1.00', category: 'won' },
        { name: 'Lost', probability: '0.00', category: 'lost' },
      ],
    });
    await deals.create(actor, { accountId: account.id, pipelineId: pipeline.id, amount: '100.00' });
    await deals.create(actor, { accountId: account.id, pipelineId: pipeline.id, amount: '200.00' });

    const board = await pipelines.getBoard(actor, pipeline.id);
    expect(board.stages).toHaveLength(3); // all stages present, even empty ones
    const openA = board.stages.find((s) => s.name === 'Open A')!;
    expect(openA.dealCount).toBe(2);
    expect(Number(openA.amountSum)).toBe(300);
    const wonStage = board.stages.find((s) => s.category === 'won')!;
    expect(wonStage.dealCount).toBe(0);
    expect(Number(wonStage.amountSum)).toBe(0);
  });

  it('account delete guard: orchestrator blocks while an open deal exists, allows once cleared', async () => {
    const account = await newAccount();
    const deal = await deals.create(actor, { accountId: account.id });
    await expect(
      orchestrator.archive(actor, account.id, account.version),
    ).rejects.toMatchObject({ code: 'conflict' });

    // Remove the open deal, then deletion succeeds.
    await deals.archive(actor, deal.id, deal.version);
    await orchestrator.archive(actor, account.id, account.version);
    await expect(accountsSvc.get(actor, account.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});
