import { pgTable, uuid, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { globalBaseColumns, citext } from '@agentos/persistence-kernel';
import { principals } from './principals.schema';

/**
 * A person — global identity, one user spans many organizations (CLAUDE.md §3.3). Shared-PK
 * specialization of `principals`: `id` is a FK to `principals.id`, not independently generated.
 */
export const users = pgTable(
  'users',
  {
    ...globalBaseColumns,
    id: uuid('id')
      .primaryKey()
      .references(() => principals.id),
    primaryEmail: citext('primary_email').notNull(),
    displayName: text('display_name').notNull(),
  },
  (t) => [
    uniqueIndex('users_primary_email_key').on(t.primaryEmail).where(sql`deleted_at is null`),
  ],
);
