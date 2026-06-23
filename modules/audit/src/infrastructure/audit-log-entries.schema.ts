import { pgTable, uuid, text, inet, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@agentos/identifier';
import { appendOnlyTimestamp } from '@agentos/persistence-kernel';

/**
 * Immutable accountability trail (CLAUDE.md §3.20) — append-only, no updated_at/deleted_at,
 * INSERT-only by grant (db/policies/030-grants.sql, CLAUDE.md §5). `actor_principal_id` is
 * nullable: some entries record actor-less events (e.g. a failed login with no resolvable
 * principal). No own FK declared here — `actor_principal_id → principals.id` is added in
 * db/migrations/0002 (cross-module, CLAUDE.md §17). Partition-ready (not yet partitioned —
 * CLAUDE.md §5/RFC §9.6) by `created_at`.
 *
 * `source_event_id` is the id of the `domain_events` row this entry was projected from (Phase 5
 * event-driven audit writer). A UNIQUE index makes the consumer idempotent under at-least-once
 * delivery: re-delivering the same event hits `ON CONFLICT (source_event_id) DO NOTHING`. It is
 * nullable (Postgres treats NULLs as distinct, so the unique index still permits any future
 * non-event-sourced entry); no FK — it must not couple to the partition-bound `domain_events`.
 */
export const auditLogEntries = pgTable(
  'audit_log_entries',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id'),
    actorPrincipalId: uuid('actor_principal_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    result: text('result').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    correlationId: text('correlation_id').notNull(),
    sourceEventId: uuid('source_event_id'),
    ...appendOnlyTimestamp,
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    index('audit_log_entries_organization_id_created_at_idx').on(
      t.organizationId,
      t.createdAt.desc(),
    ),
    index('audit_log_entries_actor_principal_id_created_at_idx').on(
      t.actorPrincipalId,
      t.createdAt.desc(),
    ),
    index('audit_log_entries_resource_type_resource_id_idx').on(t.resourceType, t.resourceId),
    // Idempotency key for the Phase 5 event-driven writer (at-least-once delivery).
    uniqueIndex('audit_log_entries_source_event_id_key').on(t.sourceEventId),
    check(
      'audit_log_entries_result_check',
      sql`${t.result} in ('allow', 'deny', 'success', 'failure')`,
    ),
  ],
);
