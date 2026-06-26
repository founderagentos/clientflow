import { pgTable, uuid, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

import { tags } from './tags.schema';

/**
 * Tag ↔ entity association (RFC-002 §2.2/§6.1) — polymorphic M:N. Workspace-scoped (§2.3) with the
 * full column contract (untagging is a soft delete). `tag_id` is a same-module FK; the polymorphic
 * `(taggable_type, taggable_id)` is validated at the application edge (the referenced row must
 * exist in-tenant). Org/workspace cross-module FKs in db/migrations/0008.
 */
export const taggables = pgTable(
  'taggables',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id),
    taggableType: text('taggable_type').notNull(),
    taggableId: uuid('taggable_id').notNull(),
  },
  (t) => [
    uniqueIndex('taggables_org_tag_target_key')
      .on(t.organizationId, t.tagId, t.taggableType, t.taggableId)
      .where(sql`deleted_at is null`),
    index('taggables_org_target_idx').on(t.organizationId, t.taggableType, t.taggableId),
  ],
);
