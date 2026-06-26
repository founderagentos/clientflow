import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { newId } from '@agentos/identifier';
import type { Tx } from '@agentos/persistence-kernel';
import { pipelines } from './pipelines.schema';
import { pipelineStages } from './pipeline-stages.schema';
import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from '../application/default-stages';

export interface SeedDefaultPipelineInput {
  organizationId: string;
  workspaceId: string;
  actorPrincipalId: string;
}

/**
 * Seeds a workspace's default Pipeline + its 6 stages (RFC-002 §2.2). Takes a caller-owned, tenant-
 * enlisted {@link Tx} (from `withTenantTransaction`), so RLS scopes every read/insert to the active
 * org+workspace. Idempotent: a pre-check skips workspaces that already have a default pipeline (the
 * fast path), and the `pipelines_one_default_per_ws_key` partial unique is the backstop under
 * at-least-once event re-delivery.
 */
@Injectable()
export class DefaultPipelineRepository {
  async seedDefault(tx: Tx, input: SeedDefaultPipelineInput): Promise<boolean> {
    const existing = await tx
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(
        and(
          eq(pipelines.organizationId, input.organizationId),
          eq(pipelines.workspaceId, input.workspaceId),
          eq(pipelines.isDefault, true),
          isNull(pipelines.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return false;
    }

    const pipelineId = newId();
    await tx.insert(pipelines).values({
      id: pipelineId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: DEFAULT_PIPELINE_NAME,
      isDefault: true,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
    await tx.insert(pipelineStages).values(
      DEFAULT_STAGES.map((stage) => ({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        pipelineId,
        name: stage.name,
        position: stage.position,
        probability: stage.probability,
        category: stage.category,
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      })),
    );
    return true;
  }
}
