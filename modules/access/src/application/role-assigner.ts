import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InternalError } from '@agentos/result-errors';
import type { Tx } from '@agentos/persistence-kernel';
import { roles } from '../infrastructure/roles.schema';
import { membershipRoles } from '../infrastructure/membership-roles.schema';

export interface AssignOwnerRoleInput {
  membershipId: string;
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
}
