import { pgTable, uuid, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * A future, assignable, due-dated action item (RFC-002 §2.2/§6.1) — future-tense, distinct from a
 * (past-tense) Activity. Overdue detection is event-driven (a scheduled relay emits TaskOverdue),
 * not a hot-path query (§2.2). Workspace-scoped (§2.3). Polymorphic optional subject link.
 * Cross-module FKs (organization/workspace/principals incl. assignee) in db/migrations/0008.
 */
export const tasks = pgTable(
  'tasks',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    assigneePrincipalId: uuid('assignee_principal_id'),
    title: text('title').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status').notNull().default('open'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('tasks_org_ws_assignee_status_idx').on(
      t.organizationId,
      t.workspaceId,
      t.assigneePrincipalId,
      t.status,
    ),
    index('tasks_org_due_idx')
      .on(t.organizationId, t.dueAt)
      .where(sql`status = 'open' and deleted_at is null`),
    check('tasks_status_check', sql`${t.status} in ('open', 'done', 'cancelled')`),
  ],
);
