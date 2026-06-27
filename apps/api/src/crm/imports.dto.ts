import { z } from 'zod';
import type { ImportJobRow } from '@agentos/crm-lead';

/**
 * Edge validation + response shaping for `/api/v1/imports` (RFC-002 §7) — bulk lead CSV ingest. The
 * CSV rides as a raw `text/csv` body (no multipart); the required `Idempotency-Key` header is the
 * job's natural key, so a resubmit returns the existing job and never double-creates leads.
 */

/** The `Idempotency-Key` header — same character grammar as the kernel idempotency middleware. */
export const importKeySchema = z
  .string({ message: 'The Idempotency-Key header is required for imports' })
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Invalid Idempotency-Key');

/** The raw CSV payload (delivered as a `text/csv` body string). */
export const importCsvSchema = z
  .string({ message: 'Send the CSV as a text/csv body' })
  .min(1, 'The CSV body must not be empty');

export function toImportJobView(row: ImportJobRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    totalRows: row.totalRows,
    createdCount: row.createdCount,
    mergedCount: row.mergedCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    errorReport: row.errorReport,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
