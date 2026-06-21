import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { MembershipService } from '@agentos/workspace';
import { RequireMembershipGuard } from './require-membership.guard';
import { currentActor } from './tenancy-actor';

/**
 * Membership management (CLAUDE.md §19 — `/api/v1/memberships`). Removal is a soft-delete that
 * emits `MemberRemoved` (Phase 4's PDP cache invalidates on it). Role changes are deferred to
 * Phase 4 role management — `membership_roles` has no soft-delete model and `app_user` holds no
 * DELETE grant, so safe role replacement is designed alongside the PDP, not here.
 */
@Controller('memberships')
@UseGuards(RequireMembershipGuard)
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.memberships.removeMember(currentActor(), id);
  }
}
