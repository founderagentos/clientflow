import { Module } from '@nestjs/common';
import { OrganizationModule } from '@agentos/organization';
import { WorkspaceModule } from '@agentos/workspace';
import { IdentityFeature } from '../onboarding/identity.feature';
import { AccessFeature } from '../access/access.feature';
import { RequireMembershipGuard } from './require-membership.guard';
import { OrganizationController } from './organization.controller';
import { WorkspaceController } from './workspace.controller';
import { MembershipController } from './membership.controller';
import { InvitationController } from './invitation.controller';
import { InvitationAcceptanceOrchestrator } from './invitation-acceptance.orchestrator';

/**
 * Host tenancy slice (CLAUDE.md §6 Phase 3) — the HTTP surface for organizations, workspaces,
 * memberships, and invitations, plus the interim membership guard and the cross-context
 * invitation-acceptance orchestrator. Hosted here (type:app) because authentication is an
 * identity concern a bounded-context module may not import (§17, Nx boundaries); it composes each
 * context's public services.
 */
@Module({
  imports: [IdentityFeature, OrganizationModule, WorkspaceModule, AccessFeature],
  controllers: [
    OrganizationController,
    WorkspaceController,
    MembershipController,
    InvitationController,
  ],
  providers: [RequireMembershipGuard, InvitationAcceptanceOrchestrator],
})
export class TenancyModule {}
