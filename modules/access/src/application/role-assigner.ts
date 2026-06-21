import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InternalError } from '@agentos/result-errors';
import type { Tx } from '@agentos/persistence-kernel';
import { roles } from '../infrastructure/roles.schema';
import { membershipRoles } from '../infrastructure/membership-roles.schema';

export interface AssignOwnerRoleInput {
  membershipId: string;
}

export interface AssignRoleInput {
  membershipId: string;
  roleId: string;
}

export interface AssignedRole {
  roleId: string;
  roleName: string;
}

/**
 * Public provisioning service: assigns the seeded system **Owner** role (organization scope,
 * `organization_id IS NULL`) to a membership (CLAUDE.md §3.1/§3.3). System roles are visible to
 * every tenant by the `roles` RLS policy; the `membership_roles` insert is permitted because
 * the membership's org matches the transaction's tenant context.
 */
@Injectable()
export class RoleAssigner {
  async assignOwner(tx: Tx, input: AssignOwnerRoleInput): Promise<AssignedRole> {
    const [owner] = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(
        and(
          isNull(roles.organizationId),
          eq(roles.scope, 'organization'),
          eq(roles.name, 'Owner'),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);

    if (!owner) {
      // The seed (db/seed/seed.ts) must have run; absence is an operational error, not user input.
      throw new InternalError('System role "Owner" is not seeded');
    }

    await tx.insert(membershipRoles).values({ membershipId: input.membershipId, roleId: owner.id });
    return { roleId: owner.id, roleName: owner.name };
  }

  /**
   * Assigns an arbitrary role (by id) to a membership — the general form used when an invited
   * member joins with their pre-assigned role (CLAUDE.md §6 Phase 3). The role must be visible
   * under the transaction's tenant context (system role, or one owned by the active org) or the
   * `membership_roles.role_id` FK rejects it. Returns the resolved role name for the event.
   */
  async assignRole(tx: Tx, input: AssignRoleInput): Promise<AssignedRole> {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), isNull(roles.deletedAt)))
      .limit(1);

    if (!role) {
      // RLS hid it (cross-tenant) or it does not exist — never confirm which (§3.8).
      throw new InternalError('Role is not assignable in this context');
    }

    await tx.insert(membershipRoles).values({ membershipId: input.membershipId, roleId: role.id });
    return { roleId: role.id, roleName: role.name };
  }
}
