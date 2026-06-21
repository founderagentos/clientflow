import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { OrganizationProvisioner } from './application/organization-provisioner';
import { OrganizationService } from './application/organization.service';
import { OrganizationsRepository } from './infrastructure/organizations.repository';

/**
 * The `organization` bounded context (CLAUDE.md §1). Exposes the public provisioning service the
 * host registration orchestrator composes, plus the Phase 3 management service the host's
 * tenancy controllers call. HTTP/guards live at the host (type:app) because authentication is an
 * identity concern a module may not import (§17, Nx boundaries). Integrate only via
 * `@agentos/contracts` and domain events.
 */
@Module({
  providers: [OrganizationProvisioner, OrganizationService, OrganizationsRepository],
  exports: [OrganizationProvisioner, OrganizationService],
})
export class OrganizationModule {}

export { OrganizationProvisioner } from './application/organization-provisioner';
export type {
  ProvisionPersonalOrganizationInput,
  ProvisionedOrganization,
} from './application/organization-provisioner';
export { OrganizationService } from './application/organization.service';
export type { OrganizationActor } from './application/organization.service';
export type {
  OrganizationRow,
  UpdateOrganizationFields,
} from './infrastructure/organizations.repository';
export type { DomainEventEnvelope };
