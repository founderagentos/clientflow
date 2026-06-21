import { Injectable } from '@nestjs/common';
import type { Tx } from '@agentos/persistence-kernel';
import { InvitationsRepository, type InvitationRow } from '../infrastructure/invitations.repository';
import { MembershipsRepository, type MembershipRow } from '../infrastructure/memberships.repository';

/**
 * Transaction-accepting writer the host invitation-acceptance orchestrator composes (CLAUDE.md
 * §3.1/§17) — the workspace-module counterpart to identity's `UserRegistrar`/`SessionIssuer`. It
 * exposes the invitation/membership steps acceptance needs to run inside the orchestrator's
 * single tenant transaction, without exporting raw repositories across the module boundary.
 */
@Injectable()
export class InvitationAcceptanceWriter {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly memberships: MembershipsRepository,
  ) {}

  loadInvitation(tx: Tx, invitationId: string): Promise<InvitationRow | null> {
    return this.invitations.findById(tx, invitationId);
  }

  markAccepted(tx: Tx, invitationId: string, actorPrincipalId: string): Promise<void> {
    return this.invitations.markAccepted(tx, invitationId, actorPrincipalId);
  }

  findExistingMembership(
    tx: Tx,
    principalId: string,
    workspaceId: string,
  ): Promise<MembershipRow | null> {
    return this.memberships.findActiveInScope(tx, principalId, workspaceId);
  }
}
