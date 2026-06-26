import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns, citext } from '@agentos/persistence-kernel';

/**
 * Top-of-funnel prospect (RFC-002 §2.2/§6.1) — unqualified, mergeable, convertible exactly once.
 * Workspace-scoped (§2.3): `workspace_id` is overridden NOT NULL. Dedup is a *signal*, not a
 * constraint (§6.2): `email_normalized`/`phone_e164`/`domain` are indexed but never uniquely —
 * real import data is legitimately duplicated. Conversion pointers (`converted_*`) are write-once,
 * enforced in the domain (Phase 4). `merged_into_lead_id` self-refs the survivor of a merge.
 * Cross-module FKs (organization/workspace/principals and converted_account/contact/deal) are
 * hand-written in db/migrations/0008 (CLAUDE.md §17). `custom_fields` is inline validated jsonb
 * governed by custom_field_definitions — not EAV (§11).
 */
export const leads = pgTable(
  'leads',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    status: text('status').notNull().default('new'),
    source: text('source'),
    name: text('name'),
    email: text('email'),
    emailNormalized: citext('email_normalized'),
    phoneE164: text('phone_e164'),
    domain: text('domain'),
    score: integer('score'),
    ownerPrincipalId: uuid('owner_principal_id'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    convertedAccountId: uuid('converted_account_id'),
    convertedContactId: uuid('converted_contact_id'),
    convertedDealId: uuid('converted_deal_id'),
    mergedIntoLeadId: uuid('merged_into_lead_id'),
    customFields: jsonb('custom_fields').notNull().default({}),
  },
  (t) => [
    // Keyset pagination (§6.3) — never OFFSET at scale.
    index('leads_org_ws_created_id_idx').on(
      t.organizationId,
      t.workspaceId,
      t.createdAt,
      t.id,
    ),
    // Dedup-match signals (§6.3) — org-scoped, non-unique.
    index('leads_org_email_normalized_idx').on(t.organizationId, t.emailNormalized),
    index('leads_org_phone_e164_idx').on(t.organizationId, t.phoneE164),
    index('leads_org_owner_idx')
      .on(t.organizationId, t.ownerPrincipalId)
      .where(sql`deleted_at is null`),
    check(
      'leads_status_check',
      sql`${t.status} in ('new', 'working', 'qualified', 'unqualified')`,
    ),
    foreignKey({
      columns: [t.mergedIntoLeadId],
      foreignColumns: [t.id],
      name: 'leads_merged_into_lead_id_fkey',
    }),
  ],
);
