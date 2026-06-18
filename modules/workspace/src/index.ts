import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { WorkspaceProvisioner } from './application/workspace-provisioner';
import { MembershipWriter } from './application/membership-writer';

/**
 * The `workspace` bounded context (CLAUDE.md §1) — workspaces, memberships, invitations. Phase
 * 2 exposes the provisioning services the host registration orchestrator composes; full
 * workspace/membership/invitation management arrives in Phase 3. Modules integrate only via
 * `@agentos/contracts` and domain events (§17).
 */
@Module({
  providers: [WorkspaceProvisioner, MembershipWriter],
  exports: [WorkspaceProvisioner, MembershipWriter],
})
export class WorkspaceModule {}

export { WorkspaceProvisioner } from './application/workspace-provisioner';
export { MembershipWriter } from './application/membership-writer';
export type {
  CreateDefaultWorkspaceInput,
  ProvisionedWorkspace,
} from './application/workspace-provisioner';
export type {
  GrantOwnerMembershipInput,
  GrantedMembership,
} from './application/membership-writer';
export type { DomainEventEnvelope };
