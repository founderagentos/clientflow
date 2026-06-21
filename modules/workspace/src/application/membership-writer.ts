import { Injectable } from '@nestjs/common';
import type { Tx } from '@agentos/persistence-kernel';
import { memberships } from '../infrastructure/memberships.schema';

export interface GrantOwnerMembershipInput {
  membershipId: string;
  organizationId: string;
  principalId: string;
  actorPrincipalId: string;
}

export interface GrantMembershipInput {
  membershipId: string;
  organizationId: string;
  /** null = org-level membership; a workspace id = workspace-level membership. */
  workspaceId: string | null;
  principalId: string;
  status?: 'invited' | 'active' | 'suspended';
  invitedBy?: string | null;
  actorPrincipalId: string;
}

export interface GrantedMembership {
  membershipId: string;
}

/**
 * Public provisioning service for `memberships` rows. {@link grantOwnerMembership} is the
 * registration special-case (org-level, active Owner); {@link grantMembership} is the general
 * form the host invitation-acceptance orchestrator uses to add an invited member to a workspace
 * (CLAUDE.md §3.1). The role(s) are attached separately by the access module's `RoleAssigner`.
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

  async grantMembership(tx: Tx, input: GrantMembershipInput): Promise<GrantedMembership> {
    await tx.insert(memberships).values({
      id: input.membershipId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      status: input.status ?? 'active',
      invitedBy: input.invitedBy ?? null,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
    return { membershipId: input.membershipId };
  }
}
