import { uuid, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { newId } from '@agentos/identifier';

/**
 * The standard column contract every tenant-owned table inherits (CLAUDE.md §3.4).
 * Spread into a `pgTable` definition; per-table migrations add the FKs
 * (created_by/updated_by → principals.id) and tenant-scoped, soft-delete-aware indexes.
 *
 *   id · organization_id · workspace_id · created_at · updated_at ·
 *   created_by · updated_by · deleted_at · version · metadata
 */
export const tenantBaseColumns = {
  id: uuid('id').primaryKey().$defaultFn(newId),
  organizationId: uuid('organization_id').notNull(),
  /** null = org-scoped (§3.4). */
  workspaceId: uuid('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  /** soft delete (§3.4). */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** optimistic lock (§3.4 — writes assert expected version → 409 on mismatch). */
  version: integer('version').notNull().default(1),
  /** extension without migration (§3.4). */
  metadata: jsonb('metadata').notNull().default({}),
} as const;

/**
 * Columns for append-only tables (audit_log_entries, domain_events): no updated_at /
 * deleted_at, INSERT-only by grant (§5). id + created/occurred timestamp are added per table.
 */
export const appendOnlyTimestamp = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
} as const;

/**
 * Column contract for platform-global tables (principals, users, identities, sessions,
 * permissions) — no organization_id/workspace_id, since these rows exist once platform-wide
 * rather than per-tenant (CLAUDE.md §3.3/§5). Soft-delete/optimistic-lock/metadata still apply.
 */
export const globalBaseColumns = {
  id: uuid('id').primaryKey().$defaultFn(newId),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  metadata: jsonb('metadata').notNull().default({}),
} as const;
