import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@agentos/identifier';

/**
 * A named permission set, contextual not global (CLAUDE.md §3.3). `organization_id` NULL =
 * system/template role (Owner/Admin/Member, seeded by db/seed/seed.ts); orgs may define
 * custom roles. `scope` discriminates organization- vs workspace-level applicability — unlike
 * the standard tenant column contract, roles have no `workspace_id` column (scope is a text
 * discriminator, not a row-level FK). `organization_id` FK to `organizations.id` is added in
 * db/migrations/0002 (cross-module, CLAUDE.md §17).
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: uuid('organization_id'),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    uniqueIndex('roles_organization_id_scope_name_key')
      .on(t.organizationId, t.scope, t.name)
      .where(sql`deleted_at is null`),
    // A plain unique index on (organization_id, scope, name) doesn't dedupe system roles:
    // Postgres treats every NULL organization_id as distinct, so it never catches a second
    // "Owner" row. This index covers exactly the organization_id IS NULL slice instead.
    uniqueIndex('roles_system_scope_name_key')
      .on(t.scope, t.name)
      .where(sql`organization_id is null and deleted_at is null`),
    check('roles_scope_check', sql`${t.scope} in ('organization', 'workspace')`),
  ],
);
