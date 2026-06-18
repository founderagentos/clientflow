import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { globalBaseColumns } from '@agentos/persistence-kernel';
import { serviceAccounts } from './service-accounts.schema';

/**
 * Service-account credentials — rotatable/revocable machine auth, never stored reversibly.
 * No own `organization_id` (tenancy is resolved by joining to `service_accounts`); RLS uses
 * an EXISTS-subquery policy against that parent table (db/policies/020-policies.sql).
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    ...globalBaseColumns,
    serviceAccountId: uuid('service_account_id')
      .notNull()
      .references(() => serviceAccounts.id),
    keyHash: text('key_hash').notNull(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_key').on(t.keyHash),
    index('api_keys_prefix_idx').on(t.prefix),
    index('api_keys_service_account_id_idx').on(t.serviceAccountId),
  ],
);
