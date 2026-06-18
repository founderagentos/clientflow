import { pgTable, uuid, text, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';
import { principals } from './principals.schema';

/**
 * Non-human principals (CLAUDE.md §3.2) — AI agents/automations/integrations need scoped,
 * auditable identities that go through the same PDP as a human (never an authZ bypass).
 * Shared-PK specialization of `principals`; `workspace_id` is mandatory here, unlike the
 * standard tenant column contract, since a service account always belongs to one workspace.
 * `organization_id`/`workspace_id` FKs to `organizations`/`workspaces` are added in
 * db/migrations/0002 (cross-module, CLAUDE.md §17).
 */
export const serviceAccounts = pgTable(
  'service_accounts',
  {
    ...tenantBaseColumns,
    id: uuid('id')
      .primaryKey()
      .references(() => principals.id),
    workspaceId: uuid('workspace_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull(),
  },
  (t) => [
    index('service_accounts_organization_id_idx').on(t.organizationId),
    index('service_accounts_workspace_id_idx').on(t.workspaceId),
    check('service_accounts_kind_check', sql`${t.kind} in ('agent', 'automation', 'integration')`),
  ],
);
