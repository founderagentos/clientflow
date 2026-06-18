import { pgTable, text, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { globalBaseColumns } from '@agentos/persistence-kernel';

/**
 * The actor supertype (CLAUDE.md §3.2) — humans and AI agents/automations are authorized and
 * audited identically. `users`/`service_accounts` specialize this via a shared primary key
 * (their `id` equals this table's `id`).
 *
 * `token_version` is the global-invalidation counter carried as an access-token claim
 * (CLAUDE.md §3.11): bumping it (password change, force-logout-all) invalidates every
 * outstanding session at the next refresh — access tokens stay valid only until their short
 * TTL expires (gate §7.5).
 */
export const principals = pgTable(
  'principals',
  {
    ...globalBaseColumns,
    type: text('type').notNull(),
    status: text('status').notNull().default('active'),
    tokenVersion: integer('token_version').notNull().default(0),
  },
  (t) => [
    check('principals_type_check', sql`${t.type} in ('user', 'service_account')`),
    check('principals_status_check', sql`${t.status} in ('active', 'suspended')`),
  ],
);
