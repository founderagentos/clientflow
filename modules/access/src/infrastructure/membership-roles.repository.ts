import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@agentos/persistence-kernel';
import type { ResolvedGrantRow } from '../domain/effective-permissions';
import { membershipRoles } from './membership-roles.schema';

export interface MembershipRef {
  principalId: string;
  workspaceId: string | null;
}

/**
 * Read/write role assignments on memberships, and the PDP's hot read path. Cross-module joins
 * to `memberships` (owned by the `workspace` context, CLAUDE.md §17) go through raw SQL rather
 * than importing another module's schema — the query stays inside the active tenant's RLS scope,
 * so it can never traverse into another organization's rows.
 */
@Injectable()
export class MembershipRolesRepository {
  async assign(tx: Tx, input: { membershipId: string; roleId: string }): Promise<void> {
    await tx
      .insert(membershipRoles)
      .values({ membershipId: input.membershipId, roleId: input.roleId })
      .onConflictDoNothing();
  }

  async revoke(tx: Tx, input: { membershipId: string; roleId: string }): Promise<void> {
    await tx
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, input.membershipId),
          eq(membershipRoles.roleId, input.roleId),
        ),
      );
  }

  async listRoleIdsByMembership(tx: Tx, membershipId: string): Promise<string[]> {
    const rows = await tx
      .select({ roleId: membershipRoles.roleId })
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, membershipId));
    return rows.map((r) => r.roleId);
  }

  /** The principal + workspace behind a membership, or null if not visible in this tenant. */
  async findMembershipRef(tx: Tx, membershipId: string): Promise<MembershipRef | null> {
    const rows = (await tx.execute(sql`
      SELECT principal_id, workspace_id
      FROM memberships
      WHERE id = ${membershipId} AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ principal_id: string; workspace_id: string | null }>;
    const row = rows[0];
    return row ? { principalId: row.principal_id, workspaceId: row.workspace_id } : null;
  }

  /**
   * The PDP hot read (CLAUDE.md §3.9): every (membership × role × permission) grant a principal
   * holds in the active organization. Returns the rows the pure scope engine
   * (`computeEffectivePermissions`) reduces to an effective set. RLS confines `memberships`/
   * `roles` to the current org; system roles are visible via `organization_id IS NULL`.
   */
  async resolveGrantsForPrincipal(tx: Tx, principalId: string): Promise<ResolvedGrantRow[]> {
    const rows = (await tx.execute(sql`
      SELECT m.workspace_id AS membership_workspace_id,
             r.scope        AS role_scope,
             p.key          AS permission_key
      FROM memberships m
      JOIN membership_roles mr ON mr.membership_id = m.id
      JOIN roles r             ON r.id = mr.role_id AND r.deleted_at IS NULL
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p       ON p.id = rp.permission_id AND p.deleted_at IS NULL
      WHERE m.principal_id = ${principalId}
        AND m.deleted_at IS NULL
        AND m.status = 'active'
    `)) as unknown as Array<{
      membership_workspace_id: string | null;
      role_scope: 'organization' | 'workspace';
      permission_key: string;
    }>;
    return rows.map((r) => ({
      membershipWorkspaceId: r.membership_workspace_id,
      roleScope: r.role_scope,
      permissionKey: r.permission_key,
    }));
  }

  /**
   * Distinct principal ids of every active membership currently holding a role — used to
   * invalidate the permission cache for everyone affected when a role's permission set changes.
   */
  async listPrincipalIdsByRole(tx: Tx, roleId: string): Promise<string[]> {
    const rows = (await tx.execute(sql`
      SELECT DISTINCT m.principal_id
      FROM membership_roles mr
      JOIN memberships m ON m.id = mr.membership_id
      WHERE mr.role_id = ${roleId} AND m.deleted_at IS NULL
    `)) as unknown as Array<{ principal_id: string }>;
    return rows.map((r) => r.principal_id);
  }
}
