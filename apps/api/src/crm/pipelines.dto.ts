import { z } from 'zod';
import type { BoardView, PipelineRow, StageRow } from '@agentos/crm-deal';

/**
 * Edge validation + response shaping for `/api/v1/pipelines` (RFC-002 §7) — sales-process
 * configuration (not ownership-narrowed; gated by `pipeline.manage`/`pipeline.read`). Probability is a
 * `numeric(3,2)` carried as a string. Stage category drives won/lost terminality.
 */

const stageCategory = z.enum(['open', 'won', 'lost']);
const probability = z.string().regex(/^\d(\.\d{1,2})?$/, 'Must be a 0–9.99 decimal');

const stageDefinition = z.object({
  name: z.string().trim().min(1).max(120),
  probability,
  category: stageCategory,
});

export const createPipelineBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().optional(),
  stages: z.array(stageDefinition).optional(),
});

export const updatePipelineBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120).optional(),
  isDefault: z.boolean().optional(),
});

export const addStageBodySchema = stageDefinition;

export const updateStageBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120).optional(),
  probability: probability.optional(),
  category: stageCategory.optional(),
});

export const reorderStagesBodySchema = z.object({
  stageIds: z.array(z.string().uuid()).min(1),
});

export function toPipelineView(row: PipelineRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    name: row.name,
    isDefault: row.isDefault,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toStageView(row: StageRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    pipelineId: row.pipelineId,
    name: row.name,
    position: row.position,
    probability: row.probability,
    category: row.category,
    version: row.version,
  };
}

/** The board is already a clean read DTO from the service — return it as-is. */
export function toBoardView(board: BoardView): BoardView {
  return board;
}
