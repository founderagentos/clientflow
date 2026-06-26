import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { newId } from '@agentos/identifier';
import { nextVersion, type Tx } from '@agentos/persistence-kernel';
import { importJobs } from './import-jobs.schema';

export interface ImportJobRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  idempotencyKey: string;
  status: string;
  totalRows: number;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  failedCount: number;
  errorReport: unknown;
  version: number;
  createdAt: Date;
}

export interface ImportJobCounts {
  totalRows: number;
  created: number;
  merged: number;
  skipped: number;
  failed: number;
  errorReport: Record<string, unknown>;
}

const ROW = {
  id: importJobs.id,
  organizationId: importJobs.organizationId,
  workspaceId: importJobs.workspaceId,
  idempotencyKey: importJobs.idempotencyKey,
  status: importJobs.status,
  totalRows: importJobs.totalRows,
  createdCount: importJobs.createdCount,
  mergedCount: importJobs.mergedCount,
  skippedCount: importJobs.skippedCount,
  failedCount: importJobs.failedCount,
  errorReport: importJobs.errorReport,
  version: importJobs.version,
  createdAt: importJobs.createdAt,
};

/**
 * Reads/writes `import_jobs` within the active org+workspace (RLS scopes every statement). The
 * `created`/`claim` pair is what makes bulk import idempotent (RFC §4.B): `createOrGet` is a no-op
 * insert on the `UNIQUE(organization_id, idempotency_key)`, so re-submitting the same key returns the
 * existing job; `claimForProcessing` (pending → processing) ensures at most one worker run even under
 * at-least-once queue delivery.
 */
@Injectable()
export class ImportJobsRepository {
  async findById(tx: Tx, id: string): Promise<ImportJobRow | null> {
    const [row] = await tx.select(ROW).from(importJobs).where(eq(importJobs.id, id)).limit(1);
    return (row as ImportJobRow | undefined) ?? null;
  }

  /**
   * Insert a pending job, or return the existing one for the same `(org, idempotency_key)`. The
   * `onConflictDoNothing` + re-select is the idempotency guard — `created=false` means a prior submit
   * already owns this key, so the caller must NOT enqueue again.
   */
  async createOrGet(
    tx: Tx,
    input: {
      organizationId: string;
      workspaceId: string;
      idempotencyKey: string;
      actorPrincipalId: string;
    },
  ): Promise<{ job: ImportJobRow; created: boolean }> {
    const inserted = await tx
      .insert(importJobs)
      .values({
        id: newId(),
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        status: 'pending',
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      })
      .onConflictDoNothing({ target: [importJobs.organizationId, importJobs.idempotencyKey] })
      .returning(ROW);
    if (inserted[0]) {
      return { job: inserted[0] as ImportJobRow, created: true };
    }
    const [existing] = await tx
      .select(ROW)
      .from(importJobs)
      .where(
        and(
          eq(importJobs.organizationId, input.organizationId),
          eq(importJobs.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return { job: existing as ImportJobRow, created: false };
  }

  /**
   * Atomically claim a pending job for processing (pending → processing). Returns false if the row is
   * not currently `pending` (already claimed/finished) — the worker then no-ops, so an at-least-once
   * re-delivery never re-imports.
   */
  async claimForProcessing(tx: Tx, id: string, actorPrincipalId: string): Promise<boolean> {
    const claimed = await tx
      .update(importJobs)
      .set({ status: 'processing', updatedAt: new Date(), updatedBy: actorPrincipalId })
      .where(and(eq(importJobs.id, id), eq(importJobs.status, 'pending')))
      .returning({ id: importJobs.id });
    return claimed.length > 0;
  }

  async complete(
    tx: Tx,
    input: { id: string; counts: ImportJobCounts; actorPrincipalId: string; expectedVersion: number },
  ): Promise<void> {
    await tx
      .update(importJobs)
      .set({
        status: 'completed',
        totalRows: input.counts.totalRows,
        createdCount: input.counts.created,
        mergedCount: input.counts.merged,
        skippedCount: input.counts.skipped,
        failedCount: input.counts.failed,
        errorReport: input.counts.errorReport,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(eq(importJobs.id, input.id));
  }

  async fail(
    tx: Tx,
    input: { id: string; errorReport: Record<string, unknown>; actorPrincipalId: string },
  ): Promise<void> {
    await tx
      .update(importJobs)
      .set({
        status: 'failed',
        errorReport: input.errorReport,
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(eq(importJobs.id, input.id));
  }
}
