import { Injectable } from '@nestjs/common';
import type { Tx } from '@agentos/persistence-kernel';
import { memberships } from '../infrastructure/memberships.schema';

export interface GrantOwnerMembershipInput {
  membershipId: string;
  organizationId: string;
  principalId: string;
  actorPrincipalId: string;
}

export interface GrantedMembership {
  membershipId: string;
}

/**
 * Public provisioning service: grants the org-level (`workspace_id = NULL`) Owner membership on
 * registration (CLAUDE.md §3.1). The Owner role is attached separately by the access module's
 * `RoleAssigner`. Membership is `active` immediately (self-provisioned, not invited).
 */
@Injectable()
export class MembershipWriter {
  async grantOwnerMembership(tx: Tx, input: GrantOwnerMembershipInput): Promise<GrantedMembership> {
    await tx.insert(memberships).values({
      id: input.membershipId,
      organizationId: input.organizationId,
      workspaceId: null,
      principalId: input.principalId,
      status: 'active',
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
    return { membershipId: input.membershipId };
  }
}
