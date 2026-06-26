import { pgTable, uuid, text, integer, jsonb, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * Bulk-import job tracking (RFC-002 §4.B/§6.1) — workspace-scoped. The `idempotency_key` makes a
 * re-POSTed import a no-op (§3.2 BulkImportOrchestrator), enforced by the org-scoped unique index.
 * Counters are updated by the BullMQ worker as rows are processed (Phase 4). Cross-module FKs in
 * db/migrations/0008.
 */
export const importJobs = pgTable(
  'import_jobs',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').notNull().default('pending'),
    totalRows: integer('total_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    mergedCount: integer('merged_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    errorReport: jsonb('error_report').notNull().default({}),
  },
  (t) => [
    uniqueIndex('import_jobs_org_idempotency_key_key').on(t.organizationId, t.idempotencyKey),
    check(
      'import_jobs_status_check',
      sql`${t.status} in ('pending', 'processing', 'completed', 'failed')`,
    ),
  ],
);
