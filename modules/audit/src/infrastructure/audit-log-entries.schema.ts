import { pgTable, uuid, text, inet, jsonb, index, check } from 'drizzle-orm/pg-core';
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
    check(
      'audit_log_entries_result_check',
      sql`${t.result} in ('allow', 'deny', 'success', 'failure')`,
    ),
  ],
);
