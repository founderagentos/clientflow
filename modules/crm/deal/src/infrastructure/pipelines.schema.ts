import { pgTable, text, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * A configurable, ordered set of Stages a Deal moves through (RFC-002 §2.2/§6.1). Configuration,
 * so it keeps the kernel `workspace_id = null → org-scoped` convention (§2.3) — workspace-scoped
 * by default, promotable to org-wide later with no migration. A workspace's first Pipeline is
 * seeded (`is_default = true`) by the WorkspaceCreated consumer (Phase 1). The partial uniques
 * enforce one name per (org, workspace) and one default per (org, workspace). Cross-module FKs in
 * db/migrations/0008.
 */
export const pipelines = pgTable(
  'pipelines',
  {
    ...tenantBaseColumns,
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [
    uniqueIndex('pipelines_org_ws_name_key')
      .on(t.organizationId, t.workspaceId, t.name)
      .where(sql`deleted_at is null`),
    uniqueIndex('pipelines_one_default_per_ws_key')
      .on(t.organizationId, t.workspaceId)
      .where(sql`is_default and deleted_at is null`),
  ],
);
