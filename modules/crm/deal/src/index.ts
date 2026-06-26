import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DefaultPipelineProvisioner } from './application/default-pipeline.provisioner';
import { DefaultPipelineRepository } from './infrastructure/default-pipeline.repository';
import { PipelinesRepository } from './infrastructure/pipelines.repository';
import { PipelineStagesRepository } from './infrastructure/pipeline-stages.repository';
import { DealsRepository } from './infrastructure/deals.repository';
import { DealStageHistoryRepository } from './infrastructure/deal-stage-history.repository';
import { PipelineService } from './application/pipeline.service';
import { DealService } from './application/deal.service';

/**
 * The CRM `deal` bounded context (RFC-002 §3.1) — Pipeline, Stage, Deal, and the append-only
 * `deal_stage_history` (the sales process). Phase 1 seeds each new workspace's default pipeline
 * (`DefaultPipelineProvisioner`, consuming the kernel `WorkspaceCreated` event). Phase 3 adds pipeline/
 * stage management, deal CRUD + assignment, and the **guarded stage transition** (terminal stages
 * require a close reason; every transition appends immutable history + emits `DealStageChanged`,
 * plus `DealWon`/`DealLost`). The board is an index-scoped aggregation. The word is **Deal** — never
 * "opportunity"/"job" (§2.1). Integrate only via `@agentos/contracts` and domain events (§17).
 */
@Module({
  providers: [
    DefaultPipelineProvisioner,
    DefaultPipelineRepository,
    PipelinesRepository,
    PipelineStagesRepository,
    DealsRepository,
    DealStageHistoryRepository,
    PipelineService,
    DealService,
  ],
  exports: [DefaultPipelineRepository, PipelineService, DealService],
})
export class CrmDealModule {}

export { DefaultPipelineProvisioner } from './application/default-pipeline.provisioner';
export { DefaultPipelineRepository } from './infrastructure/default-pipeline.repository';
export type { SeedDefaultPipelineInput } from './infrastructure/default-pipeline.repository';
export { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from './application/default-stages';
export type { DefaultStage, StageCategory } from './application/default-stages';

export { PipelineService } from './application/pipeline.service';
export { DealService } from './application/deal.service';
export type { DealActor } from './application/deal-actor';
export type { PipelineRow } from './infrastructure/pipelines.repository';
export type { StageRow } from './infrastructure/pipeline-stages.repository';
export type { DealRow } from './infrastructure/deals.repository';
export type {
  CreatePipelineInput,
  AddStageInput,
  BoardStage,
  BoardView,
} from './application/pipeline.service';
export type {
  CreateDealInput,
  TransitionDealInput,
  CloseDealInput,
  ListDealsInput,
} from './application/deal.service';
