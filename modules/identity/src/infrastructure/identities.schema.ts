import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { globalBaseColumns } from '@agentos/persistence-kernel';
import { users } from './users.schema';

/**
 * Authentication credentials — decouples *who you are* (`users`) from *how you prove it*.
 * One user may sign in via several providers (password, OAuth, ...).
 */
export const identities = pgTable(
  'identities',
  {
    ...globalBaseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    /** Argon2id hash; password provider only (CLAUDE.md §3.13). */
    secretHash: text('secret_hash'),
    lastAuthenticatedAt: timestamp('last_authenticated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('identities_provider_subject_key').on(t.provider, t.providerSubject),
    index('identities_user_id_idx').on(t.userId),
  ],
);
