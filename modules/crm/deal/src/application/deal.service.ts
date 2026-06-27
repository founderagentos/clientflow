import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
  type Tx,
} from '@agentos/persistence-kernel';
import { newId } from '@agentos/identifier';
import {
  AUTHORIZATION,
  authorizeCommand,
  ownerListFilter,
  type AuthorizationPort,
} from '@agentos/authorization';
import { DealAggregateType, DealEventType } from '@agentos/contracts';
import {
  DealsRepository,
  type DealRow,
  type DealKeysetCursor,
  type DealUpdatableFields,
} from '../infrastructure/deals.repository';
import { PipelinesRepository } from '../infrastructure/pipelines.repository';
import { PipelineStagesRepository, type StageRow } from '../infrastructure/pipeline-stages.repository';
import { DealStageHistoryRepository } from '../infrastructure/deal-stage-history.repository';
import { assertTransitionAllowed } from '../domain/deal-transition';
import type { DealActor } from './deal-actor';

export interface CreateDealInput {
  accountId: string;
  pipelineId?: string;
  stageId?: string;
  primaryContactId?: string | null;
  amount?: string | null;
  currency?: string | null;
  expectedCloseDate?: string | null;
  ownerPrincipalId?: string | null;
  customFields?: Record<string, unknown>;
}

export interface TransitionDealInput {
  dealId: string;
  toStageId: string;
  expectedVersion: number;
  closeReason?: string | null;
}

export interface CloseDealInput {
  dealId: string;
  outcome: 'won' | 'lost';
  closeReason: string;
  expectedVersion: number;
}

export interface ListDealsInput {
  limit: number;
  cursor?: DealKeysetCursor;
}

/**
 * Deal lifecycle within the active org+workspace (RFC-002 §2.2/§4) — create (in the default pipeline's
 * first open stage), update, assign, archive, and the **guarded stage transition**. Every write runs
 * in a tenant transaction and emits its event. A transition asserts the deal `version` (→ 409),
 * appends an immutable `deal_stage_history` row, and emits `DealStageChanged` (+ `DealWon`/`DealLost`
 * when terminal). The word is **Deal** — never "opportunity"/"job" (§2.1).
 */
@Injectable()
export class DealService {
  constructor(
    private readonly deals: DealsRepository,
    private readonly pipelines: PipelinesRepository,
    private readonly stages: PipelineStagesRepository,
    private readonly history: DealStageHistoryRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(AUTHORIZATION) private readonly authz: AuthorizationPort,
  ) {}

  async get(actor: DealActor, id: string): Promise<DealRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const deal = await this.requireDeal(tx, id);
      await authorizeCommand(this.authz, actor, 'deal.read', {
        resource: 'deal',
        ownerPrincipalId: deal.ownerPrincipalId,
      });
      return deal;
    });
  }

  async list(actor: DealActor, input: ListDealsInput): Promise<DealRow[]> {
    await authorizeCommand(this.authz, actor, 'deal.read');
    const ownerFilter = await ownerListFilter(this.authz, actor, 'deal');
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.deals.listByWorkspace(tx, input.limit, input.cursor, ownerFilter),
    );
  }

  async countOpenDealsForAccount(actor: DealActor, accountId: string): Promise<number> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.deals.countOpenForAccount(tx, accountId),
    );
  }

  async create(actor: DealActor, input: CreateDealInput): Promise<DealRow> {
    await authorizeCommand(this.authz, actor, 'deal.create');
    // Default owner to the creator so ownership scoping is meaningful (RFC §8.2). The conversion
    // path uses createWithin directly (owner left null — a manager-gated composite op).
    const withOwner = { ...input, ownerPrincipalId: input.ownerPrincipalId ?? actor.principalId };
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.createWithin(tx, actor, withOwner),
    );
  }

  /**
   * Tx-taking create — no transaction of its own, composed by the `LeadConversionOrchestrator`
   * inside its single cross-module transaction. `create()` is a thin wrapper around this so the
   * insert+initial-history+`DealCreated` path is shared (DRY; public behavior unchanged).
   */
  async createWithin(tx: Tx, actor: DealActor, input: CreateDealInput): Promise<DealRow> {
    const dealId = newId();
    const pipeline = input.pipelineId
      ? await this.pipelines.findById(tx, input.pipelineId)
      : await this.pipelines.findDefault(tx);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }
    const stage = input.stageId
      ? await this.requireStageInPipeline(tx, input.stageId, pipeline.id)
      : await this.requireFirstOpenStage(tx, pipeline.id);

    await this.deals.insert(tx, {
      id: dealId,
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      accountId: input.accountId,
      primaryContactId: input.primaryContactId ?? null,
      pipelineId: pipeline.id,
      stageId: stage.id,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
      ownerPrincipalId: input.ownerPrincipalId ?? null,
      customFields: input.customFields ?? {},
      actorPrincipalId: actor.principalId,
    });
    // Initial history row so stage-velocity has a clean entry timestamp from creation.
    await this.history.append(tx, {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      dealId,
      fromStageId: null,
      toStageId: stage.id,
      durationInPreviousSeconds: null,
      actorPrincipalId: actor.principalId,
    });
    await this.outbox.append(tx, {
      ...this.eventBase(actor, dealId),
      type: DealEventType.DealCreated,
      payload: {
        dealId,
        accountId: input.accountId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        ownerPrincipalId: input.ownerPrincipalId ?? null,
      },
    });
    return this.requireDeal(tx, dealId);
  }

  async update(
    actor: DealActor,
    id: string,
    expectedVersion: number,
    fields: DealUpdatableFields,
  ): Promise<DealRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const deal = await this.requireDeal(tx, id);
      await authorizeCommand(this.authz, actor, 'deal.update', {
        resource: 'deal',
        ownerPrincipalId: deal.ownerPrincipalId,
      });
      const changed = await this.deals.update(tx, {
        id,
        expectedVersion,
        actorPrincipalId: actor.principalId,
        fields,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: DealEventType.DealUpdated,
        payload: { dealId: id, changed },
      });
      return this.requireDeal(tx, id);
    });
  }

  async assign(
    actor: DealActor,
    id: string,
    expectedVersion: number,
    ownerPrincipalId: string | null,
  ): Promise<DealRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const deal = await this.requireDeal(tx, id);
      await authorizeCommand(this.authz, actor, 'deal.assign', {
        resource: 'deal',
        ownerPrincipalId: deal.ownerPrincipalId,
      });
      await this.deals.assign(tx, {
        id,
        expectedVersion,
        ownerPrincipalId,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: DealEventType.DealAssigned,
        payload: { dealId: id, ownerPrincipalId, previousOwnerPrincipalId: deal.ownerPrincipalId },
      });
      return this.requireDeal(tx, id);
    });
  }

  async archive(actor: DealActor, id: string, expectedVersion: number): Promise<void> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const deal = await this.requireDeal(tx, id);
      await authorizeCommand(this.authz, actor, 'deal.delete', {
        resource: 'deal',
        ownerPrincipalId: deal.ownerPrincipalId,
      });
      await this.deals.archive(tx, { id, expectedVersion, actorPrincipalId: actor.principalId });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: DealEventType.DealDeleted,
        payload: { dealId: id },
      });
    });
  }

  /** Guarded stage transition (RFC §4.D). */
  async transition(actor: DealActor, input: TransitionDealInput): Promise<DealRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const deal = await this.requireDeal(tx, input.dealId);
      await authorizeCommand(this.authz, actor, 'deal.transition', {
        resource: 'deal',
        ownerPrincipalId: deal.ownerPrincipalId,
      });
      const fromStage = await this.requireStage(tx, deal.stageId);
      const toStage = await this.requireStage(tx, input.toStageId);
      await this.performTransition(tx, actor, {
        deal,
        fromStage,
        toStage,
        expectedVersion: input.expectedVersion,
        closeReason: input.closeReason ?? null,
      });
      return this.requireDeal(tx, input.dealId);
    });
  }

  /** Convenience closure (RFC §7 `/closure`): resolve the pipeline's terminal stage, then transition. */
  async close(actor: DealActor, input: CloseDealInput): Promise<DealRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const deal = await this.requireDeal(tx, input.dealId);
      await authorizeCommand(this.authz, actor, 'deal.close', {
        resource: 'deal',
        ownerPrincipalId: deal.ownerPrincipalId,
      });
      const fromStage = await this.requireStage(tx, deal.stageId);
      const toStage = await this.stages.findTerminalStage(tx, deal.pipelineId, input.outcome);
      if (!toStage) {
        throw new ValidationError(`This pipeline has no ${input.outcome} stage to close into`);
      }
      await this.performTransition(tx, actor, {
        deal,
        fromStage,
        toStage,
        expectedVersion: input.expectedVersion,
        closeReason: input.closeReason,
      });
      return this.requireDeal(tx, input.dealId);
    });
  }

  private async performTransition(
    tx: Tx,
    actor: DealActor,
    input: {
      deal: DealRow;
      fromStage: StageRow;
      toStage: StageRow;
      expectedVersion: number;
      closeReason: string | null;
    },
  ): Promise<void> {
    const { terminal } = assertTransitionAllowed(
      { id: input.fromStage.id, pipelineId: input.fromStage.pipelineId, category: input.fromStage.category },
      { id: input.toStage.id, pipelineId: input.toStage.pipelineId, category: input.toStage.category },
      input.closeReason,
    );
    const latest = await this.history.findLatestForDeal(tx, input.deal.id);
    const durationInPreviousSeconds = latest
      ? Math.max(0, Math.floor((Date.now() - latest.enteredAt.getTime()) / 1000))
      : null;

    await this.deals.transitionStage(tx, {
      id: input.deal.id,
      expectedVersion: input.expectedVersion,
      toStageId: input.toStage.id,
      terminal,
      closeReason: input.closeReason,
      actorPrincipalId: actor.principalId,
    });
    await this.history.append(tx, {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      dealId: input.deal.id,
      fromStageId: input.fromStage.id,
      toStageId: input.toStage.id,
      durationInPreviousSeconds,
      actorPrincipalId: actor.principalId,
    });
    await this.outbox.append(tx, {
      ...this.eventBase(actor, input.deal.id),
      type: DealEventType.DealStageChanged,
      payload: {
        dealId: input.deal.id,
        fromStageId: input.fromStage.id,
        toStageId: input.toStage.id,
        fromCategory: input.fromStage.category,
        toCategory: input.toStage.category,
        durationInPreviousSeconds,
      },
    });
    if (terminal === 'won') {
      await this.outbox.append(tx, {
        ...this.eventBase(actor, input.deal.id),
        type: DealEventType.DealWon,
        payload: {
          dealId: input.deal.id,
          amount: input.deal.amount,
          currency: input.deal.currency,
          closeReason: input.closeReason ?? '',
        },
      });
    } else if (terminal === 'lost') {
      await this.outbox.append(tx, {
        ...this.eventBase(actor, input.deal.id),
        type: DealEventType.DealLost,
        payload: { dealId: input.deal.id, closeReason: input.closeReason ?? '' },
      });
    }
  }

  private async requireDeal(tx: Tx, id: string): Promise<DealRow> {
    const row = await this.deals.findById(tx, id);
    if (!row) {
      throw new NotFoundError('Deal not found');
    }
    return row;
  }

  private async requireStage(tx: Tx, id: string): Promise<StageRow> {
    const row = await this.stages.findById(tx, id);
    if (!row) {
      throw new NotFoundError('Stage not found');
    }
    return row;
  }

  private async requireStageInPipeline(tx: Tx, stageId: string, pipelineId: string): Promise<StageRow> {
    const stage = await this.requireStage(tx, stageId);
    if (stage.pipelineId !== pipelineId) {
      throw new ValidationError('The stage does not belong to the pipeline');
    }
    return stage;
  }

  private async requireFirstOpenStage(tx: Tx, pipelineId: string): Promise<StageRow> {
    const stage = await this.stages.firstOpenStage(tx, pipelineId);
    if (!stage) {
      throw new ValidationError('The pipeline has no open stage to place the deal in');
    }
    return stage;
  }

  private eventBase(actor: DealActor, dealId: string) {
    return {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      actorPrincipalId: actor.principalId,
      correlationId: actor.correlationId,
      causationId: null,
      aggregateType: DealAggregateType.Deal,
      aggregateId: dealId,
    };
  }

  private scope(actor: DealActor): { organizationId: string; workspaceId: string } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
