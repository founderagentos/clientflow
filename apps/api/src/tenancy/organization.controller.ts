import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { OrganizationService, type OrganizationRow } from '@agentos/organization';
import { RequireMembershipGuard } from './require-membership.guard';
import { currentActor } from './tenancy-actor';
import { consentBodySchema, updateOrganizationBodySchema } from './tenancy.dto';

function toView(org: OrganizationRow) {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    status: org.status,
    homeRegion: org.homeRegion,
    planTierCache: org.planTierCache,
    dataProcessingConsent: org.dataProcessingConsent,
    version: org.version,
  };
}

/**
 * Active-organization management (CLAUDE.md §19 — `/api/v1/organizations`). Scoped to the
 * caller's token organization (RLS pins the tenant); cross-org listing is the deferred
 * context-switch slice. `data_processing_consent` has its own route so it is never toggled as a
 * side effect of a profile update (§3.16). Hosted here, not in the organization module, because
 * authentication is an identity concern a module may not import (§17).
 */
@Controller('organizations')
@UseGuards(RequireMembershipGuard)
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get('current')
  async current() {
    return toView(await this.organizations.getCurrent(currentActor()));
  }

  @Patch('current')
  async update(@Body() body: unknown) {
    const { expectedVersion, ...fields } = updateOrganizationBodySchema.parse(body);
    return toView(await this.organizations.update(currentActor(), expectedVersion, fields));
  }

  @Put('current/data-processing-consent')
  async setConsent(@Body() body: unknown) {
    const { consent, expectedVersion } = consentBodySchema.parse(body);
    return toView(
      await this.organizations.setDataProcessingConsent(currentActor(), expectedVersion, consent),
    );
  }
}
