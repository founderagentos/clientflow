import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { OrganizationProvisioner } from './application/organization-provisioner';

/**
 * The `organization` bounded context (CLAUDE.md §1). Phase 2 exposes the public provisioning
 * service the host registration orchestrator composes; full organization management arrives in
 * Phase 3. Modules integrate only via `@agentos/contracts` and domain events (§17).
 */
@Module({
  providers: [OrganizationProvisioner],
  exports: [OrganizationProvisioner],
})
export class OrganizationModule {}

export { OrganizationProvisioner } from './application/organization-provisioner';
export type {
  ProvisionPersonalOrganizationInput,
  ProvisionedOrganization,
} from './application/organization-provisioner';
export type { DomainEventEnvelope };
