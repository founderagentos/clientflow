import { z } from 'zod';

/**
 * CRM `deal` context domain events (RFC-002 §9; CLAUDE.md §3.14/§3.15) — PastTense, emitted to the
 * transactional outbox in the same DB transaction as the state change. Covers the sales process:
 * pipeline/stage configuration and the deal lifecycle. A terminal stage transition emits
 * `DealStageChanged` **and** `DealWon`/`DealLost` (RFC §4.D) — both in the same unit of work.
 * `numeric` columns (amount) are carried as strings to avoid float drift.
 */
export const DealEventType = {
  PipelineCreated: 'PipelineCreated',
  PipelineUpdated: 'PipelineUpdated',
  PipelineStageAdded: 'PipelineStageAdded',
  PipelineStageUpdated: 'PipelineStageUpdated',
  PipelineStagesReordered: 'PipelineStagesReordered',
  DealCreated: 'DealCreated',
  DealUpdated: 'DealUpdated',
  DealDeleted: 'DealDeleted',
  DealAssigned: 'DealAssigned',
  DealStageChanged: 'DealStageChanged',
  DealWon: 'DealWon',
  DealLost: 'DealLost',
} as const;

export type DealEventType = (typeof DealEventType)[keyof typeof DealEventType];

/** Aggregate-type labels for the outbox `aggregate_type` column. */
export const DealAggregateType = {
  Pipeline: 'Pipeline',
  Deal: 'Deal',
} as const;

export const StageCategory = {
  Open: 'open',
  Won: 'won',
  Lost: 'lost',
} as const;

export type StageCategory = (typeof StageCategory)[keyof typeof StageCategory];

const stageCategorySchema = z.enum([StageCategory.Open, StageCategory.Won, StageCategory.Lost]);

export const pipelineCreatedPayload = z.object({
  pipelineId: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
});

export const pipelineUpdatedPayload = z.object({
  pipelineId: z.string(),
  changed: z.array(z.string()),
});

export const pipelineStageAddedPayload = z.object({
  pipelineId: z.string(),
  stageId: z.string(),
  name: z.string(),
  position: z.number().int(),
  category: stageCategorySchema,
});

export const pipelineStageUpdatedPayload = z.object({
  pipelineId: z.string(),
  stageId: z.string(),
  changed: z.array(z.string()),
});

export const pipelineStagesReorderedPayload = z.object({
  pipelineId: z.string(),
  stageIdsInOrder: z.array(z.string()),
});

export const dealCreatedPayload = z.object({
  dealId: z.string(),
  accountId: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  ownerPrincipalId: z.string().nullable(),
});

export const dealUpdatedPayload = z.object({
  dealId: z.string(),
  changed: z.array(z.string()),
});

export const dealDeletedPayload = z.object({
  dealId: z.string(),
});

export const dealAssignedPayload = z.object({
  dealId: z.string(),
  ownerPrincipalId: z.string().nullable(),
  previousOwnerPrincipalId: z.string().nullable(),
});

export const dealStageChangedPayload = z.object({
  dealId: z.string(),
  fromStageId: z.string().nullable(),
  toStageId: z.string(),
  fromCategory: stageCategorySchema.nullable(),
  toCategory: stageCategorySchema,
  durationInPreviousSeconds: z.number().int().nullable(),
});

export const dealWonPayload = z.object({
  dealId: z.string(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  closeReason: z.string(),
});

export const dealLostPayload = z.object({
  dealId: z.string(),
  closeReason: z.string(),
});

export type PipelineCreatedPayload = z.infer<typeof pipelineCreatedPayload>;
export type PipelineUpdatedPayload = z.infer<typeof pipelineUpdatedPayload>;
export type PipelineStageAddedPayload = z.infer<typeof pipelineStageAddedPayload>;
export type PipelineStageUpdatedPayload = z.infer<typeof pipelineStageUpdatedPayload>;
export type PipelineStagesReorderedPayload = z.infer<typeof pipelineStagesReorderedPayload>;
export type DealCreatedPayload = z.infer<typeof dealCreatedPayload>;
export type DealUpdatedPayload = z.infer<typeof dealUpdatedPayload>;
export type DealDeletedPayload = z.infer<typeof dealDeletedPayload>;
export type DealAssignedPayload = z.infer<typeof dealAssignedPayload>;
export type DealStageChangedPayload = z.infer<typeof dealStageChangedPayload>;
export type DealWonPayload = z.infer<typeof dealWonPayload>;
export type DealLostPayload = z.infer<typeof dealLostPayload>;
