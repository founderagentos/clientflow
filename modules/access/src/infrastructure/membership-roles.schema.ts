import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { roles } from './roles.schema';

/**
 * Role assignment to a membership — a member can hold several roles; effective permissions
 * are the union (CLAUDE.md §3.11.4). Bare junction table, same irregular shape as
 * `role_permissions` (CLAUDE.md §5). `membership_id` FK to `memberships.id` is added in
 * db/migrations/0002 (cross-module, CLAUDE.md §17).
 */
export const membershipRoles = pgTable(
  'membership_roles',
  {
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleId] }),
    index('membership_roles_role_id_idx').on(t.roleId),
  ],
);
