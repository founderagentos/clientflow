import { pgTable, uuid, text, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * A business the tenant sells to or serves (RFC-002 §2.1/§6.1) — the durable book of business.
 * **NOT** the kernel `Organization` (which is the tenant itself); an Account lives *inside* a
 * tenant boundary. Workspace-scoped (§2.3). Cross-module FKs (organization/workspace/principals)
 * in db/migrations/0008. `custom_fields` is inline jsonb governed by definitions, not EAV (§11).
 */
export const accounts = pgTable(
  'accounts',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    name: text('name').notNull(),
    domain: text('domain'),
    industry: text('industry'),
    sizeBand: text('size_band'),
    address: jsonb('address').notNull().default({}),
    ownerPrincipalId: uuid('owner_principal_id'),
    customFields: jsonb('custom_fields').notNull().default({}),
  },
  (t) => [
    index('accounts_org_ws_created_id_idx').on(
      t.organizationId,
      t.workspaceId,
      t.createdAt,
      t.id,
    ),
    index('accounts_org_domain_idx').on(t.organizationId, t.domain),
    index('accounts_org_owner_idx')
      .on(t.organizationId, t.ownerPrincipalId)
      .where(sql`deleted_at is null`),
  ],
);
