import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { NotFoundError } from '@agentos/result-errors';
import { assertVersionMatched, nextVersion, softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import { deals } from './deals.schema';
import { pipelineStages } from './pipeline-stages.schema';

export interface DealRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  accountId: string;
  primaryContactId: string | null;
  pipelineId: string;
  stageId: string;
  amount: string | null;
  currency: string | null;
  expectedCloseDate: string | null;
  ownerPrincipalId: string | null;
  closeReason: string | null;
  closedAt: Date | null;
  customFields: unknown;
  version: number;
  createdAt: Date;
}

export interface DealKeysetCursor {
  createdAt: Date;
  id: string;
}

export interface DealInsert {
  id: string;
  organizationId: string;
  workspaceId: string;
  accountId: string;
  primaryContactId: string | null;
  pipelineId: string;
  stageId: string;
  amount: string | null;
  currency: string | null;
  expectedCloseDate: string | null;
  ownerPrincipalId: string | null;
  customFields: Record<string, unknown>;
  actorPrincipalId: string;
}

export interface DealUpdatableFields {
  amount?: string | null | undefined;
  currency?: string | null | undefined;
  expectedCloseDate?: string | null | undefined;
  primaryContactId?: string | null | undefined;
  customFields?: Record<string, unknown> | undefined;
}

export interface StageBoardCount {
  stageId: string;
  dealCount: number;
  amountSum: string;
}

const FK_VIOLATION = '23503';
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === FK_VIOLATION
  );
}

const ROW = {
  id: deals.id,
  organizationId: deals.organizationId,
  workspaceId: deals.workspaceId,
  accountId: deals.accountId,
  primaryContactId: deals.primaryContactId,
  pipelineId: deals.pipelineId,
  stageId: deals.stageId,
  amount: deals.amount,
  currency: deals.currency,
  expectedCloseDate: deals.expectedCloseDate,
  ownerPrincipalId: deals.ownerPrincipalId,
  closeReason: deals.closeReason,
  closedAt: deals.closedAt,
  customFields: deals.customFields,
  version: deals.version,
  createdAt: deals.createdAt,
};

/** Reads/writes `deals` within the active org+workspace (RLS scopes every statement). */
@Injectable()
export class DealsRepository {
  async findById(tx: Tx, id: string): Promise<DealRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(deals)
      .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
      .limit(1);
    return (row as DealRow | undefined) ?? null;
  }

  async listByWorkspace(tx: Tx, limit: number, cursor?: DealKeysetCursor): Promise<DealRow[]> {
    const where = cursor
      ? and(
          isNull(deals.deletedAt),
          or(
            lt(deals.createdAt, cursor.createdAt),
            and(eq(deals.createdAt, cursor.createdAt), lt(deals.id, cursor.id)),
          ),
        )
      : isNull(deals.deletedAt);
    return tx
      .select(ROW)
      .from(deals)
      .where(where)
      .orderBy(desc(deals.createdAt), desc(deals.id))
      .limit(limit) as Promise<DealRow[]>;
  }

  async insert(tx: Tx, input: DealInsert): Promise<void> {
    try {
      await tx.insert(deals).values({
        id: input.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        primaryContactId: input.primaryContactId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        amount: input.amount,
        currency: input.currency,
        expectedCloseDate: input.expectedCloseDate,
        ownerPrincipalId: input.ownerPrincipalId,
        customFields: input.customFields,
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundError('Referenced account, contact, pipeline, or stage not found');
      }
      throw error;
    }
  }

  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: DealUpdatableFields;
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as keyof DealUpdatableFields] !== undefined,
    );
    const rows = await tx
      .update(deals)
      .set({
        ...input.fields,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: deals.id });
    assertVersionMatched(rows.length);
    return changed;
  }

  /** Move the deal to a new stage, optimistic-locked. Sets close_reason/closed_at when terminal. */
  async transitionStage(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStageId: string;
      terminal: 'won' | 'lost' | null;
      closeReason: string | null;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    const rows = await tx
      .update(deals)
      .set({
        stageId: input.toStageId,
        closeReason: input.terminal ? input.closeReason : null,
        closedAt: input.terminal ? new Date() : null,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: deals.id });
    assertVersionMatched(rows.length);
  }

  async assign(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      ownerPrincipalId: string | null;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    const rows = await tx
      .update(deals)
      .set({
        ownerPrincipalId: input.ownerPrincipalId,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: deals.id });
    assertVersionMatched(rows.length);
  }

  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(deals)
      .set({
        ...softDeletePatch(input.actorPrincipalId),
        version: nextVersion(input.expectedVersion),
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: deals.id });
    assertVersionMatched(rows.length);
  }

  /** Count of an account's open deals (stage category = open) — the account delete guard signal. */
  async countOpenForAccount(tx: Tx, accountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(
        and(
          eq(deals.accountId, accountId),
          isNull(deals.deletedAt),
          eq(pipelineStages.category, 'open'),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * Per-stage deal count + summed amount for one pipeline (RFC §4.E) — an index-scoped aggregation
   * over `deals_board_idx`, bounded to this pipeline in this workspace (never a whole-table scan).
   * `amountSum` sums `deals.amount` as-is (single-currency assumption — cross-currency rollup is an
   * Analytics concern, §10). Stages with no deals are absent here; the service merges in the zeros.
   */
  async boardAggregation(tx: Tx, pipelineId: string): Promise<StageBoardCount[]> {
    const rows = await tx
      .select({
        stageId: deals.stageId,
        dealCount: sql<number>`count(*)::int`,
        amountSum: sql<string>`coalesce(sum(${deals.amount}), 0)::text`,
      })
      .from(deals)
      .where(and(eq(deals.pipelineId, pipelineId), isNull(deals.deletedAt)))
      .groupBy(deals.stageId);
    return rows.map((r) => ({
      stageId: r.stageId,
      dealCount: Number(r.dealCount),
      amountSum: r.amountSum,
    }));
  }

  private lockPredicate(id: string, expectedVersion: number) {
    return and(eq(deals.id, id), eq(deals.version, expectedVersion), isNull(deals.deletedAt));
  }
}
