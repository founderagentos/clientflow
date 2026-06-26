import { pgTable, uuid, text, boolean, timestamp, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * The unified engagement timeline (RFC-002 §2.2/§6.1) — the *business* record of what happened,
 * distinct from the kernel `audit_log_entries` (the immutable *security* record). Polymorphic
 * subject (`subject_type`/`subject_id`) validated at the application edge. `is_system = true` rows
 * (e.g. a rendered StageChanged) are immutable — enforced by a command-specific FOR UPDATE RLS
 * policy (db/policies/050-crm-policies.sql); user-authored notes are editable under optimistic lock
 * (Phase 2+). Workspace-scoped (§2.3). Partition-ready by `occurred_at` monthly (§6.3). Cross-module
 * FKs in db/migrations/0008.
 */
export const activities = pgTable(
  'activities',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    type: text('type').notNull(),
    body: jsonb('body').notNull().default({}),
    isSystem: boolean('is_system').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activities_org_subject_idx').on(t.organizationId, t.subjectType, t.subjectId),
    index('activities_org_ws_occurred_idx').on(
      t.organizationId,
      t.workspaceId,
      t.occurredAt.desc(),
    ),
    check(
      'activities_type_check',
      sql`${t.type} in ('note', 'call', 'email', 'meeting', 'task_event', 'system')`,
    ),
  ],
);
