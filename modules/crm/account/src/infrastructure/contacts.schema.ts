import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns, citext } from '@agentos/persistence-kernel';

/**
 * A person at an Account, or floating (RFC-002 §2.1/§6.1) — the durable people entity. **NOT** a
 * kernel `User`/`Principal`; a Contact never authenticates. Holds PII (names, emails, phones).
 * `erased_at` marks GDPR/DPDP erasure (§8.4) — distinct from soft delete (`deleted_at`): erasure
 * purges PII columns and leaves a tombstone so referencing Deals/history stay valid (Phase 2).
 * Workspace-scoped (§2.3). `emails`/`phones` are jsonb arrays; `primary_email_normalized` is the
 * citext dedup signal (not unique — §6.2). Cross-module FKs in db/migrations/0008.
 */
export const contacts = pgTable(
  'contacts',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    emails: jsonb('emails').notNull().default([]),
    phones: jsonb('phones').notNull().default([]),
    primaryEmailNormalized: citext('primary_email_normalized'),
    title: text('title'),
    ownerPrincipalId: uuid('owner_principal_id'),
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    customFields: jsonb('custom_fields').notNull().default({}),
  },
  (t) => [
    index('contacts_org_ws_created_id_idx').on(
      t.organizationId,
      t.workspaceId,
      t.createdAt,
      t.id,
    ),
    index('contacts_org_primary_email_normalized_idx').on(
      t.organizationId,
      t.primaryEmailNormalized,
    ),
    index('contacts_org_owner_idx')
      .on(t.organizationId, t.ownerPrincipalId)
      .where(sql`deleted_at is null`),
  ],
);
