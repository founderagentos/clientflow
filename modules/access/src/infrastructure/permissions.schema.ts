import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { globalBaseColumns } from '@agentos/persistence-kernel';

/**
 * The capability catalog — explicit, granular `resource.action` permissions (CLAUDE.md §3.10).
 * Every module ships its permission rows here; this catalog is the contract between modules
 * and the PDP. Global (platform-wide), not tenant-owned.
 */
export const permissions = pgTable(
  'permissions',
  {
    ...globalBaseColumns,
    key: text('key').notNull(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    description: text('description'),
  },
  (t) => [uniqueIndex('permissions_key_key').on(t.key)],
);
