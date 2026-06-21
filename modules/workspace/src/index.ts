import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { WorkspaceProvisioner } from './application/workspace-provisioner';
import { MembershipWriter } from './application/membership-writer';
import { WorkspaceService } from './application/workspace.service';
import { MembershipService } from './application/membership.service';
import { InvitationService } from './application/invitation.service';
import { InvitationAcceptanceWriter } from './application/invitation-acceptance.writer';
import { WorkspacesRepository } from './infrastructure/workspaces.repository';
import { MembershipsRepository } from './infrastructure/memberships.repository';
import { InvitationsRepository } from './infrastructure/invitations.repository';
import { InvitationLookupRepository } from './infrastructure/invitation-lookup.repository';

/**
 * The `workspace` bounded context (CLAUDE.md §1) — workspaces (bounded nesting ≤ 3), memberships
 * (org- and workspace-level), and invitations. Exposes the Phase 2 provisioning services the host
 * registration orchestrator composes, plus the Phase 3 management services the host's tenancy
 * controllers and invitation-acceptance orchestrator call. HTTP/guards live at the host because
 * authentication is an identity concern a module may not import (§17, Nx boundaries). Integrate
 * only via `@agentos/contracts` and domain events.
 */
@Module({
  providers: [
    WorkspaceProvisioner,
    MembershipWriter,
    WorkspaceService,
    MembershipService,
    InvitationService,
    InvitationAcceptanceWriter,
    WorkspacesRepository,
    MembershipsRepository,
    InvitationsRepository,
    InvitationLookupRepository,
  ],
  exports: [
    WorkspaceProvisioner,
    MembershipWriter,
    WorkspaceService,
    MembershipService,
    InvitationService,
    InvitationAcceptanceWriter,
    InvitationLookupRepository,
  ],
})
export class WorkspaceModule {}

export { WorkspaceProvisioner } from './application/workspace-provisioner';
export { MembershipWriter } from './application/membership-writer';
export { WorkspaceService } from './application/workspace.service';
export { MembershipService } from './application/membership.service';
export { InvitationService } from './application/invitation.service';
export { InvitationAcceptanceWriter } from './application/invitation-acceptance.writer';
export { InvitationLookupRepository } from './infrastructure/invitation-lookup.repository';
export { decideInvitation } from './domain/invitation-decision';
export { hashInvitationToken } from './domain/invitation-token';
export type {
  CreateDefaultWorkspaceInput,
  ProvisionedWorkspace,
} from './application/workspace-provisioner';
export type {
  GrantOwnerMembershipInput,
  GrantMembershipInput,
  GrantedMembership,
} from './application/membership-writer';
export type { WorkspaceActor, CreateWorkspaceInput } from './application/workspace.service';
export type { MembershipActor } from './application/membership.service';
export type { InvitationActor, CreateInvitationInput, CreatedInvitation } from './application/invitation.service';
export type { WorkspaceRow } from './infrastructure/workspaces.repository';
export type { MembershipRow } from './infrastructure/memberships.repository';
export type { InvitationRow } from './infrastructure/invitations.repository';
export type { InvitationLookup } from './infrastructure/invitation-lookup.repository';
export type { InvitationState, InvitationDecision } from './domain/invitation-decision';
export type { DomainEventEnvelope };
