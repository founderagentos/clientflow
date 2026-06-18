import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns, citext } from '@agentos/persistence-kernel';

/**
 * Pending workspace joins — team onboarding without pre-creating a user. `role_id` pre-assigns
 * the role the invitee receives on acceptance. `workspace_id` is mandatory here (an invitation
 * always targets one workspace), unlike the standard tenant column contract. `role_id`/
 * `invited_by` FKs are added in db/migrations/0002 (cross-module, CLAUDE.md §17).
 */
export const invitations = pgTable(
  'invitations',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    email: citext('email').notNull(),
    roleId: uuid('role_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    invitedBy: uuid('invited_by'),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    index('invitations_organization_id_workspace_id_idx').on(t.organizationId, t.workspaceId),
    index('invitations_email_idx').on(t.email),
    check(
      'invitations_status_check',
      sql`${t.status} in ('pending', 'accepted', 'revoked', 'expired')`,
    ),
  ],
);
