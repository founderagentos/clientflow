import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@agentos/identifier';
import { citext } from '@agentos/persistence-kernel';

/**
 * Operational boundary inside an organization (CLAUDE.md §5) — e.g. an agency's client-A vs
 * client-B. `parent_workspace_id` allows nesting, bounded to depth ≤ 3 (enforced in the
 * application layer, not the DB — CLAUDE.md §15.5). Composed manually rather than via
 * `tenantBaseColumns`: a workspace's own tenant-scope column is `organization_id` only — it
 * has no `workspace_id` referring to itself.
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: uuid('organization_id').notNull(),
    parentWorkspaceId: uuid('parent_workspace_id'),
    slug: citext('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    uniqueIndex('workspaces_organization_id_slug_key')
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at is null`),
    index('workspaces_organization_id_idx').on(t.organizationId),
    index('workspaces_parent_workspace_id_idx').on(t.parentWorkspaceId),
    check('workspaces_status_check', sql`${t.status} in ('active', 'suspended', 'archived')`),
    foreignKey({
      columns: [t.parentWorkspaceId],
      foreignColumns: [t.id],
      name: 'workspaces_parent_workspace_id_fkey',
    }),
  ],
);
