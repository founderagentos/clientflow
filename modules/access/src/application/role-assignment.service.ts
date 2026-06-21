import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
import type { Tx } from '@agentos/persistence-kernel';
import { RolesRepository } from '../infrastructure/roles.repository';
import { MembershipRolesRepository } from '../infrastructure/membership-roles.repository';

/**
 * Assigns/revokes roles on a membership (CLAUDE.md §3.3 — access is granted per workspace via
 * membership). Returns the affected principal id so the host orchestrator can emit the
 * `RoleAssigned`/`RoleRevoked` event and invalidate that principal's permission cache. Both the
 * role and the membership must be visible under the active tenant's RLS scope, or the lookup
 * returns 404 (never confirming a cross-tenant resource, §3.8). The seeded-Owner provisioning
 * path stays in `RoleAssigner` (used by registration/invitation).
 */
@Injectable()
export class RoleAssignmentService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly membershipRoles: MembershipRolesRepository,
  ) {}

  async assign(
    tx: Tx,
    input: { membershipId: string; roleId: string },
  ): Promise<{ principalId: string; roleName: string }> {
    const role = await this.roles.findById(tx, input.roleId);
    if (!role) {
      throw new NotFoundError('Role not found');
    }
    const ref = await this.membershipRoles.findMembershipRef(tx, input.membershipId);
    if (!ref) {
      throw new NotFoundError('Membership not found');
    }
    await this.membershipRoles.assign(tx, input);
    return { principalId: ref.principalId, roleName: role.name };
  }

  async revoke(
    tx: Tx,
    input: { membershipId: string; roleId: string },
  ): Promise<{ principalId: string }> {
    const ref = await this.membershipRoles.findMembershipRef(tx, input.membershipId);
    if (!ref) {
      throw new NotFoundError('Membership not found');
    }
    await this.membershipRoles.revoke(tx, input);
    return { principalId: ref.principalId };
  }

  /** Principals currently holding a role — for invalidating their permission caches on change. */
  async affectedPrincipals(tx: Tx, roleId: string): Promise<string[]> {
    return this.membershipRoles.listPrincipalIdsByRole(tx, roleId);
  }
}
