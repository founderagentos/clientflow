import { pgTable, uuid, text, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * A principal's relationship to a scope — membership grants access, no implicit access
 * (CLAUDE.md §3). `workspace_id` NULL = org-level membership (Owner/Admin/Billing-Manager);
 * non-null = workspace-level. `principal_id`/`invited_by` FKs to `principals.id` are added in
 * db/migrations/0002 (cross-module, CLAUDE.md §17).
 */
export const memberships = pgTable(
  'memberships',
  {
    ...tenantBaseColumns,
    principalId: uuid('principal_id').notNull(),
    status: text('status').notNull().default('invited'),
    invitedBy: uuid('invited_by'),
  },
  (t) => [
    uniqueIndex('memberships_org_workspace_principal_key')
      .on(t.organizationId, t.workspaceId, t.principalId)
      .where(sql`deleted_at is null`),
    index('memberships_principal_id_idx').on(t.principalId),
    index('memberships_organization_id_workspace_id_idx').on(t.organizationId, t.workspaceId),
    check('memberships_status_check', sql`${t.status} in ('invited', 'active', 'suspended')`),
  ],
);
