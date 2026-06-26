import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { assertVersionMatched, nextVersion, type Tx } from '@agentos/persistence-kernel';
import { pipelineStages } from './pipeline-stages.schema';

export interface StageRow {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  pipelineId: string;
  name: string;
  position: number;
  /** numeric(3,2) — Drizzle returns it as a string. */
  probability: string;
  category: 'open' | 'won' | 'lost';
  version: number;
}

export interface StageUpdatableFields {
  name?: string | undefined;
  position?: number | undefined;
  probability?: string | undefined;
  category?: 'open' | 'won' | 'lost' | undefined;
}

const ROW = {
  id: pipelineStages.id,
  organizationId: pipelineStages.organizationId,
  workspaceId: pipelineStages.workspaceId,
  pipelineId: pipelineStages.pipelineId,
  name: pipelineStages.name,
  position: pipelineStages.position,
  probability: pipelineStages.probability,
  category: pipelineStages.category,
  version: pipelineStages.version,
};

/** Reads/writes `pipeline_stages` within the active org+workspace (RLS scopes every statement). */
@Injectable()
export class PipelineStagesRepository {
  async findById(tx: Tx, id: string): Promise<StageRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(pipelineStages)
      .where(and(eq(pipelineStages.id, id), isNull(pipelineStages.deletedAt)))
      .limit(1);
    return (row as StageRow | undefined) ?? null;
  }

  async listByPipeline(tx: Tx, pipelineId: string): Promise<StageRow[]> {
    return tx
      .select(ROW)
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.deletedAt)))
      .orderBy(asc(pipelineStages.position)) as Promise<StageRow[]>;
  }

  /** The first OPEN stage (lowest position) — a new deal's initial stage (RFC §4.C). */
  async firstOpenStage(tx: Tx, pipelineId: string): Promise<StageRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.pipelineId, pipelineId),
          eq(pipelineStages.category, 'open'),
          isNull(pipelineStages.deletedAt),
        ),
      )
      .orderBy(asc(pipelineStages.position))
      .limit(1);
    return (row as StageRow | undefined) ?? null;
  }

  /** The first terminal stage of a category — the target a `close({outcome})` resolves to. */
  async findTerminalStage(
    tx: Tx,
    pipelineId: string,
    category: 'won' | 'lost',
  ): Promise<StageRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.pipelineId, pipelineId),
          eq(pipelineStages.category, category),
          isNull(pipelineStages.deletedAt),
        ),
      )
      .orderBy(asc(pipelineStages.position))
      .limit(1);
    return (row as StageRow | undefined) ?? null;
  }

  async insert(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      workspaceId: string | null;
      pipelineId: string;
      name: string;
      position: number;
      probability: string;
      category: 'open' | 'won' | 'lost';
      actorPrincipalId: string;
    },
  ): Promise<void> {
    await tx.insert(pipelineStages).values({
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      pipelineId: input.pipelineId,
      name: input.name,
      position: input.position,
      probability: input.probability,
      category: input.category,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
  }

  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: StageUpdatableFields;
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as keyof StageUpdatableFields] !== undefined,
    );
    const rows = await tx
      .update(pipelineStages)
      .set({
        ...input.fields,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(
        and(
          eq(pipelineStages.id, input.id),
          eq(pipelineStages.version, input.expectedVersion),
          isNull(pipelineStages.deletedAt),
        ),
      )
      .returning({ id: pipelineStages.id });
    assertVersionMatched(rows.length);
    return changed;
  }

  /** Bulk re-position stages (the order array is the new positions, 1-based). No per-row opt-lock. */
  async reorder(
    tx: Tx,
    input: { stageIdsInOrder: string[]; actorPrincipalId: string },
  ): Promise<void> {
    for (let i = 0; i < input.stageIdsInOrder.length; i++) {
      await tx
        .update(pipelineStages)
        .set({ position: i + 1, updatedAt: new Date(), updatedBy: input.actorPrincipalId })
        .where(and(eq(pipelineStages.id, input.stageIdsInOrder[i]!), isNull(pipelineStages.deletedAt)));
    }
  }
}
