import { pgTable, uuid, text, timestamp, inet, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { globalBaseColumns } from '@agentos/persistence-kernel';
import { principals } from './principals.schema';

/**
 * Authenticated context / refresh-token family (CLAUDE.md §3.12). `familyId` enables
 * refresh-reuse theft detection: reusing an already-rotated token revokes the whole family.
 */
export const sessions = pgTable(
  'sessions',
  {
    ...globalBaseColumns,
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    deviceLabel: text('device_label'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_refresh_token_hash_key').on(t.refreshTokenHash),
    index('sessions_principal_id_idx').on(t.principalId).where(sql`revoked_at is null`),
    index('sessions_family_id_idx').on(t.familyId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);
