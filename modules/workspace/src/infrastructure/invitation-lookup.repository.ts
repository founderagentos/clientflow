import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database, type Executor } from '@agentos/persistence-kernel';

export interface InvitationLookup {
  id: string;
  organizationId: string;
  workspaceId: string;
  email: string;
  roleId: string;
  status: string;
  expiresAt: Date;
}

/**
 * Pre-auth invitation lookup by token hash. `invitations` is RLS-protected and an invitee
 * accepting a link has no tenant context yet (and may have no account at all) — the same
 * chicken-and-egg as auth-time membership resolution. This calls the SECURITY DEFINER function
 * `auth_invitation_by_token_hash(text)` (db/policies/041-invitation-functions.sql), owned by the
 * BYPASSRLS role, which performs one narrow parameterized read keyed by the unguessable token
 * hash. It never widens visibility (the caller must already hold the token), so cross-tenant
 * isolation is preserved (CLAUDE.md §7 gate 1). The host orchestrator uses the returned org/
 * workspace to open the RLS transaction that actually creates the membership.
 */
@Injectable()
export class InvitationLookupRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByTokenHash(
    tokenHash: string,
    executor: Executor = this.db,
  ): Promise<InvitationLookup | null> {
    const rows = (await executor.execute(
      sql`select id, organization_id, workspace_id, email, role_id, status, expires_at from auth_invitation_by_token_hash(${tokenHash})`,
    )) as unknown as Array<{
      id: string;
      organization_id: string;
      workspace_id: string;
      email: string;
      role_id: string;
      status: string;
      expires_at: string | Date;
    }>;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      email: row.email,
      roleId: row.role_id,
      status: row.status,
      expiresAt: new Date(row.expires_at),
    };
  }
}
