import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { ConflictError } from '@agentos/result-errors';
import { assertVersionMatched, nextVersion, type Tx } from '@agentos/persistence-kernel';
import { pipelines } from './pipelines.schema';

export interface PipelineRow {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  isDefault: boolean;
  version: number;
  createdAt: Date;
}

export interface PipelineUpdatableFields {
  name?: string | undefined;
  isDefault?: boolean | undefined;
}

const UNIQUE_VIOLATION = '23505';
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION
  );
}

const ROW = {
  id: pipelines.id,
  organizationId: pipelines.organizationId,
  workspaceId: pipelines.workspaceId,
  name: pipelines.name,
  isDefault: pipelines.isDefault,
  version: pipelines.version,
  createdAt: pipelines.createdAt,
};

/** Reads/writes `pipelines` within the active org+workspace (RLS scopes every statement). */
@Injectable()
export class PipelinesRepository {
  async findById(tx: Tx, id: string): Promise<PipelineRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(pipelines)
      .where(and(eq(pipelines.id, id), isNull(pipelines.deletedAt)))
      .limit(1);
    return (row as PipelineRow | undefined) ?? null;
  }

  /** The active default pipeline visible in this context (workspace-scoped wins by RLS). */
  async findDefault(tx: Tx): Promise<PipelineRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(pipelines)
      .where(and(eq(pipelines.isDefault, true), isNull(pipelines.deletedAt)))
      .limit(1);
    return (row as PipelineRow | undefined) ?? null;
  }

  async list(tx: Tx): Promise<PipelineRow[]> {
    return tx
      .select(ROW)
      .from(pipelines)
      .where(isNull(pipelines.deletedAt))
      .orderBy(pipelines.createdAt) as Promise<PipelineRow[]>;
  }

  async insert(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      workspaceId: string;
      name: string;
      isDefault: boolean;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    try {
      await tx.insert(pipelines).values({
        id: input.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        name: input.name,
        isDefault: input.isDefault,
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A pipeline with this name already exists in the workspace');
      }
      throw error;
    }
  }

  /** Demote the current default pipeline(s), except `keepId` if given (set before promoting a new one). */
  async clearDefault(tx: Tx, actorPrincipalId: string, keepId?: string): Promise<void> {
    const predicate = keepId
      ? and(eq(pipelines.isDefault, true), isNull(pipelines.deletedAt), ne(pipelines.id, keepId))
      : and(eq(pipelines.isDefault, true), isNull(pipelines.deletedAt));
    await tx
      .update(pipelines)
      .set({ isDefault: false, updatedAt: new Date(), updatedBy: actorPrincipalId })
      .where(predicate);
  }

  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: PipelineUpdatableFields;
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as keyof PipelineUpdatableFields] !== undefined,
    );
    try {
      const rows = await tx
        .update(pipelines)
        .set({
          ...input.fields,
          version: nextVersion(input.expectedVersion),
          updatedAt: new Date(),
          updatedBy: input.actorPrincipalId,
        })
        .where(
          and(
            eq(pipelines.id, input.id),
            eq(pipelines.version, input.expectedVersion),
            isNull(pipelines.deletedAt),
          ),
        )
        .returning({ id: pipelines.id });
      assertVersionMatched(rows.length);
      return changed;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A pipeline with this name already exists in the workspace');
      }
      throw error;
    }
  }
}
