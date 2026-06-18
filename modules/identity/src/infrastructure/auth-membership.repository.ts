import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database, type Executor } from '@agentos/persistence-kernel';

export interface ActiveMembership {
  membershipId: string;
  organizationId: string;
  workspaceId: string | null;
  status: string;
}

/**
 * Resolves a principal's active memberships across tenants at auth time. `memberships` is
 * RLS-protected and login has no tenant context yet, so this calls the SECURITY DEFINER
 * `auth_principal_memberships(uuid)` function (db/policies/040-auth-functions.sql) — a narrow,
 * single-principal read owned by the BYPASSRLS role. It never widens visibility, so tenant
 * isolation is preserved (CLAUDE.md §7 gate 1).
 */
@Injectable()
export class AuthMembershipRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findActiveForPrincipal(
    principalId: string,
    executor: Executor = this.db,
  ): Promise<ActiveMembership[]> {
    const rows = (await executor.execute(
      sql`select membership_id, organization_id, workspace_id, status from auth_principal_memberships(${principalId})`,
    )) as unknown as Array<{
      membership_id: string;
      organization_id: string;
      workspace_id: string | null;
      status: string;
    }>;
    return rows.map((row) => ({
      membershipId: row.membership_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      status: row.status,
    }));
  }
}
