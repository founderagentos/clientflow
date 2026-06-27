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
import { AUTHORIZATION, authorizeCommand, type AuthorizationPort } from '@agentos/authorization';
import { DealAggregateType, DealEventType } from '@agentos/contracts';
import { PipelinesRepository, type PipelineRow } from '../infrastructure/pipelines.repository';
import { PipelineStagesRepository, type StageRow } from '../infrastructure/pipeline-stages.repository';
import { DealsRepository } from '../infrastructure/deals.repository';
import type { DealActor } from './deal-actor';

export interface CreatePipelineInput {
  name: string;
  isDefault?: boolean;
  stages?: Array<{ name: string; probability: string; category: 'open' | 'won' | 'lost' }>;
}

export interface AddStageInput {
  name: string;
  probability: string;
  category: 'open' | 'won' | 'lost';
}

export interface BoardStage {
  stageId: string;
  name: string;
  position: number;
  probability: string;
  category: 'open' | 'won' | 'lost';
  dealCount: number;
  amountSum: string;
}

export interface BoardView {
  pipelineId: string;
  stages: BoardStage[];
}

/**
 * Pipeline & stage configuration within the active org+workspace (RFC-002 §2.2). Every write runs in
 * a tenant transaction and emits its event. The board (`getBoard`) is an index-scoped aggregation
 * over `deals_board_idx` (the maintained counter is deferred — activate on signals); it returns every
 * stage of the pipeline, with zero counts for empty stages.
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly pipelines: PipelinesRepository,
    private readonly stages: PipelineStagesRepository,
    private readonly deals: DealsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(AUTHORIZATION) private readonly authz: AuthorizationPort,
  ) {}

  async list(actor: DealActor): Promise<PipelineRow[]> {
    await authorizeCommand(this.authz, actor, 'pipeline.read');
    return withTenantTransaction(this.db, this.scope(actor), (tx) => this.pipelines.list(tx));
  }

  async create(actor: DealActor, input: CreatePipelineInput): Promise<PipelineRow> {
    await authorizeCommand(this.authz, actor, 'pipeline.manage');
    const pipelineId = newId();
    const isDefault = input.isDefault ?? false;
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      if (isDefault) {
        await this.pipelines.clearDefault(tx, actor.principalId);
      }
      await this.pipelines.insert(tx, {
        id: pipelineId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        name: input.name,
        isDefault,
        actorPrincipalId: actor.principalId,
      });
      let position = 1;
      for (const stage of input.stages ?? []) {
        await this.stages.insert(tx, {
          id: newId(),
          organizationId: actor.organizationId,
          workspaceId: actor.workspaceId,
          pipelineId,
          name: stage.name,
          position: position++,
          probability: stage.probability,
          category: stage.category,
          actorPrincipalId: actor.principalId,
        });
      }
      await this.outbox.append(tx, {
        ...this.eventBase(actor, pipelineId),
        type: DealEventType.PipelineCreated,
        payload: { pipelineId, name: input.name, isDefault },
      });
      return this.requirePipeline(tx, pipelineId);
    });
  }

  async update(
    actor: DealActor,
    id: string,
    expectedVersion: number,
    fields: { name?: string; isDefault?: boolean },
  ): Promise<PipelineRow> {
    await authorizeCommand(this.authz, actor, 'pipeline.manage');
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.pipelines.findById(tx, id);
      if (!existing) {
        throw new NotFoundError('Pipeline not found');
      }
      if (fields.isDefault === true) {
        await this.pipelines.clearDefault(tx, actor.principalId, id);
      }
      const changed = await this.pipelines.update(tx, {
        id,
        expectedVersion,
        actorPrincipalId: actor.principalId,
        fields,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: DealEventType.PipelineUpdated,
        payload: { pipelineId: id, changed },
      });
      return this.requirePipeline(tx, id);
    });
  }

  async getBoard(actor: DealActor, pipelineId: string): Promise<BoardView> {
    await authorizeCommand(this.authz, actor, 'pipeline.read');
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const pipeline = await this.pipelines.findById(tx, pipelineId);
      if (!pipeline) {
        throw new NotFoundError('Pipeline not found');
      }
      const stages = await this.stages.listByPipeline(tx, pipelineId);
      const counts = await this.deals.boardAggregation(tx, pipelineId);
      const byStage = new Map(counts.map((c) => [c.stageId, c]));
      return {
        pipelineId,
        stages: stages.map((s) => ({
          stageId: s.id,
          name: s.name,
          position: s.position,
          probability: s.probability,
          category: s.category,
          dealCount: byStage.get(s.id)?.dealCount ?? 0,
          amountSum: byStage.get(s.id)?.amountSum ?? '0',
        })),
      };
    });
  }

  async addStage(actor: DealActor, pipelineId: string, input: AddStageInput): Promise<StageRow> {
    await authorizeCommand(this.authz, actor, 'pipeline.manage');
    const stageId = newId();
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      if (!(await this.pipelines.findById(tx, pipelineId))) {
        throw new NotFoundError('Pipeline not found');
      }
      const existing = await this.stages.listByPipeline(tx, pipelineId);
      const position = existing.length + 1;
      await this.stages.insert(tx, {
        id: stageId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        pipelineId,
        name: input.name,
        position,
        probability: input.probability,
        category: input.category,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, pipelineId),
        type: DealEventType.PipelineStageAdded,
        payload: { pipelineId, stageId, name: input.name, position, category: input.category },
      });
      const stage = await this.stages.findById(tx, stageId);
      if (!stage) {
        throw new NotFoundError('Stage not found');
      }
      return stage;
    });
  }

  async updateStage(
    actor: DealActor,
    stageId: string,
    expectedVersion: number,
    fields: { name?: string; probability?: string; category?: 'open' | 'won' | 'lost' },
  ): Promise<StageRow> {
    await authorizeCommand(this.authz, actor, 'pipeline.manage');
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.stages.findById(tx, stageId);
      if (!existing) {
        throw new NotFoundError('Stage not found');
      }
      const changed = await this.stages.update(tx, {
        id: stageId,
        expectedVersion,
        actorPrincipalId: actor.principalId,
        fields,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, existing.pipelineId),
        type: DealEventType.PipelineStageUpdated,
        payload: { pipelineId: existing.pipelineId, stageId, changed },
      });
      const stage = await this.stages.findById(tx, stageId);
      if (!stage) {
        throw new NotFoundError('Stage not found');
      }
      return stage;
    });
  }

  async reorderStages(
    actor: DealActor,
    pipelineId: string,
    stageIdsInOrder: string[],
  ): Promise<void> {
    await authorizeCommand(this.authz, actor, 'pipeline.manage');
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      if (!(await this.pipelines.findById(tx, pipelineId))) {
        throw new NotFoundError('Pipeline not found');
      }
      const current = await this.stages.listByPipeline(tx, pipelineId);
      const currentIds = new Set(current.map((s) => s.id));
      const givenIds = new Set(stageIdsInOrder);
      const sameSet =
        currentIds.size === givenIds.size && [...currentIds].every((id) => givenIds.has(id));
      if (!sameSet || stageIdsInOrder.length !== current.length) {
        throw new ValidationError('The provided stage order must list exactly the pipeline’s stages');
      }
      await this.stages.reorder(tx, { stageIdsInOrder, actorPrincipalId: actor.principalId });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, pipelineId),
        type: DealEventType.PipelineStagesReordered,
        payload: { pipelineId, stageIdsInOrder },
      });
    });
  }

  private async requirePipeline(tx: Tx, id: string): Promise<PipelineRow> {
    const row = await this.pipelines.findById(tx, id);
    if (!row) {
      throw new NotFoundError('Pipeline not found');
    }
    return row;
  }

  private eventBase(actor: DealActor, pipelineId: string) {
    return {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      actorPrincipalId: actor.principalId,
      correlationId: actor.correlationId,
      causationId: null,
      aggregateType: DealAggregateType.Pipeline,
      aggregateId: pipelineId,
    };
  }

  private scope(actor: DealActor): { organizationId: string; workspaceId: string } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
