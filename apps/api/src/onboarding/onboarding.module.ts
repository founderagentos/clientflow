import { Module } from '@nestjs/common';
import { OrganizationModule } from '@agentos/organization';
import { WorkspaceModule } from '@agentos/workspace';
import { IdentityFeature } from './identity.feature';
import { AccessFeature } from '../access/access.feature';
import { RegistrationOrchestrator } from './registration.orchestrator';
import { RegistrationController } from './registration.controller';

/**
 * Host onboarding slice — the only place permitted to compose multiple bounded contexts
 * (CLAUDE.md §17). Imports each context's public provisioning surface; the orchestrator weaves
 * them into one atomic registration.
 */
@Module({
  imports: [IdentityFeature, OrganizationModule, WorkspaceModule, AccessFeature],
  controllers: [RegistrationController],
  providers: [RegistrationOrchestrator],
})
export class OnboardingModule {}
