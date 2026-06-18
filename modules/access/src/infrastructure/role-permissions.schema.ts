import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { roles } from './roles.schema';
import { permissions } from './permissions.schema';

/**
 * Role↔permission map. Bare junction table — intentionally skips the full standard column
 * contract (no deleted_at/version/metadata/created_by/updated_by): CLAUDE.md §5 calls this
 * table out by name as one of the three pure junction/child tables with an irregular shape.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('role_permissions_permission_id_idx').on(t.permissionId),
  ],
);
