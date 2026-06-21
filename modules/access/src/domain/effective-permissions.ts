import type { RoleScope } from '@agentos/contracts';

/**
 * One resolved (membership × role × permission) grant row, as read by the PDP's hot query
 * (`MembershipRolesRepository.resolveGrantsForPrincipal`). The PDP never trusts the client —
 * these rows come from the database under the active tenant's RLS scope.
 */
export interface ResolvedGrantRow {
  /** The membership's workspace; `null` = an organization-level membership. */
  membershipWorkspaceId: string | null;
  /** The assigned role's applicability scope. */
  roleScope: RoleScope;
  /** The `resource.action` permission the role grants. */
  permissionKey: string;
}

/** The scope a permission check is evaluated against. `null` = an org-scoped operation. */
export interface PermissionScope {
  workspaceId: string | null;
}

/**
 * Pure scope engine — computes the effective permission set for a principal at a target scope
 * by unioning the grants that apply there (CLAUDE.md §3.3, §3.11). The rules (deliberately
 * explicit — this is the easiest part to get subtly wrong):
 *
 * - An **organization-level membership** (`membershipWorkspaceId === null`) contributes its
 *   **organization-scoped** roles' permissions to every workspace *and* to org-scoped checks.
 * - A **workspace-level membership** (`membershipWorkspaceId === W`) contributes its roles'
 *   permissions **only** when the check targets workspace `W`.
 * - An **org-scoped check** (`target.workspaceId === null`) includes only org-level
 *   memberships' organization-scoped role permissions.
 * - System roles (org_id NULL) are honored identically — applicability is the role's `scope`,
 *   never row ownership.
 */
export function computeEffectivePermissions(
  rows: readonly ResolvedGrantRow[],
  target: PermissionScope,
): Set<string> {
  const effective = new Set<string>();
  for (const row of rows) {
    if (grantApplies(row, target)) {
      effective.add(row.permissionKey);
    }
  }
  return effective;
}

function grantApplies(row: ResolvedGrantRow, target: PermissionScope): boolean {
  if (target.workspaceId === null) {
    // Org-scoped check: only org-level memberships' organization-scoped roles.
    return row.membershipWorkspaceId === null && row.roleScope === 'organization';
  }
  if (row.membershipWorkspaceId === null) {
    // Org-wide grant reaches every workspace.
    return row.roleScope === 'organization';
  }
  // Workspace-level membership applies only to its own workspace.
  return row.membershipWorkspaceId === target.workspaceId;
}
