import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * A workspace-defined classification label (RFC-002 §2.2/§6.1). Configuration — keeps the kernel
 * `workspace_id = null → org-scoped` convention (§2.3). Distinct from the kernel `metadata` jsonb
 * (reserved for ad-hoc, non-queryable extension). Cross-module FKs in db/migrations/0008.
 */
export const tags = pgTable(
  'tags',
  {
    ...tenantBaseColumns,
    name: text('name').notNull(),
    color: text('color'),
  },
  (t) => [
    uniqueIndex('tags_org_ws_name_key')
      .on(t.organizationId, t.workspaceId, t.name)
      .where(sql`deleted_at is null`),
  ],
);
