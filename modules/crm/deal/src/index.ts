import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DefaultPipelineProvisioner } from './application/default-pipeline.provisioner';
import { DefaultPipelineRepository } from './infrastructure/default-pipeline.repository';

/**
 * The CRM `deal` bounded context (RFC-002 §3.1) — Pipeline, Stage, Deal, and the append-only
 * `deal_stage_history` (the sales process). Phase 1 ships the schema (§6.1) plus the
 * `DefaultPipelineProvisioner`, which seeds each new workspace's default pipeline by consuming the
 * kernel `WorkspaceCreated` event (the kernel stays CRM-unaware — CLAUDE.md §17). Guarded stage
 * transitions, board counter, and the deal CRUD/API land in Phase 3. The word is **Deal** — never
 * "opportunity"/"job" (§2.1). Integrate only via `@agentos/contracts` and domain events.
 */
@Module({
  providers: [DefaultPipelineProvisioner, DefaultPipelineRepository],
  exports: [DefaultPipelineRepository],
})
export class CrmDealModule {}

export { DefaultPipelineProvisioner } from './application/default-pipeline.provisioner';
export { DefaultPipelineRepository } from './infrastructure/default-pipeline.repository';
export type { SeedDefaultPipelineInput } from './infrastructure/default-pipeline.repository';
export { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from './application/default-stages';
export type { DefaultStage, StageCategory } from './application/default-stages';
