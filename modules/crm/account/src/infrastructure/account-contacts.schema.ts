import { pgTable, uuid, text, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

import { accounts } from './accounts.schema';
import { contacts } from './contacts.schema';

/**
 * Account ↔ Contact relationship (RFC-002 §2.2/§6.1) — M:N, with a relationship role and a single
 * primary contact per Account. Workspace-scoped (§2.3) and carries the full column contract (soft
 * delete; untagging an association is a soft delete, not a hard DELETE). `account_id`/`contact_id`
 * are same-module FKs (`.references()`); the org/workspace cross-module FKs are in
 * db/migrations/0008. The partial unique enforces ≤1 primary contact per account (§2.2).
 */
export const accountContacts = pgTable(
  'account_contacts',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    relationshipRole: text('relationship_role'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    uniqueIndex('account_contacts_org_account_contact_key')
      .on(t.organizationId, t.accountId, t.contactId)
      .where(sql`deleted_at is null`),
    uniqueIndex('account_contacts_one_primary_per_account_key')
      .on(t.organizationId, t.accountId)
      .where(sql`is_primary and deleted_at is null`),
    index('account_contacts_org_contact_idx').on(t.organizationId, t.contactId),
  ],
);
