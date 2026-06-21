import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '@agentos/result-errors';
import type { Tx } from '@agentos/persistence-kernel';
import { RolesRepository } from '../infrastructure/roles.repository';
import { PermissionsRepository } from '../infrastructure/permissions.repository';
import { RolePermissionsRepository } from '../infrastructure/role-permissions.repository';
import { MembershipRolesRepository } from '../infrastructure/membership-roles.repository';

export interface PermissionMapResult {
  /** Principals whose effective permissions changed — their cache must be invalidated. */
  affectedPrincipalIds: string[];
}

/**
 * Maps permissions onto custom roles (CLAUDE.md §6 Phase 4). Changing a role's permission set
 * changes the effective permissions of every principal assigned that role, so each mutation
 * returns the affected principal ids for the orchestrator to invalidate in the cache.
 */
@Injectable()
export class RolePermissionService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly rolePermissions: RolePermissionsRepository,
    private readonly membershipRoles: MembershipRolesRepository,
  ) {}

  async grant(tx: Tx, input: { roleId: string; permissionKey: string }): Promise<PermissionMapResult> {
    const permissionId = await this.resolveForCustomRole(tx, input.roleId, input.permissionKey);
    await this.rolePermissions.grant(tx, { roleId: input.roleId, permissionId });
    return this.affected(tx, input.roleId);
  }

  async revoke(tx: Tx, input: { roleId: string; permissionKey: string }): Promise<PermissionMapResult> {
    const permissionId = await this.resolveForCustomRole(tx, input.roleId, input.permissionKey);
    await this.rolePermissions.revoke(tx, { roleId: input.roleId, permissionId });
    return this.affected(tx, input.roleId);
  }

  private async resolveForCustomRole(tx: Tx, roleId: string, permissionKey: string): Promise<string> {
    const role = await this.roles.findById(tx, roleId);
    if (!role) {
      throw new NotFoundError('Role not found');
    }
    if (role.isSystem) {
      throw new ValidationError('System roles cannot be modified', {
        role: ['system roles are immutable'],
      });
    }
    const permission = await this.permissions.findByKey(tx, permissionKey);
    if (!permission) {
      throw new ValidationError('Unknown permission', { permission: ['not in catalog'] });
    }
    return permission.id;
  }

  private async affected(tx: Tx, roleId: string): Promise<PermissionMapResult> {
    return { affectedPrincipalIds: await this.membershipRoles.listPrincipalIdsByRole(tx, roleId) };
  }
}
