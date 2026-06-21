import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { currentActor } from '../tenancy/tenancy-actor';
import { RequirePermissionGuard } from './require-permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { RoleAssignmentOrchestrator } from './role-assignment.orchestrator';
import { assignRoleBodySchema } from './access.dto';

/**
 * Role assignment on a membership (`/api/v1/memberships/:membershipId/roles`, CLAUDE.md §3.3).
 * Guarded by `role.assign`. Revocation invalidates the principal's permission cache immediately
 * (gate §7.5).
 */
@Controller('memberships')
@UseGuards(RequirePermissionGuard)
export class RoleAssignmentsController {
  constructor(private readonly orchestrator: RoleAssignmentOrchestrator) {}

  @Post(':membershipId/roles')
  @RequirePermission('role.assign')
  async assign(@Param('membershipId') membershipId: string, @Body() body: unknown) {
    const { roleId } = assignRoleBodySchema.parse(body);
    await this.orchestrator.assign(currentActor(), membershipId, roleId);
    return { ok: true };
  }

  @Delete(':membershipId/roles/:roleId')
  @RequirePermission('role.assign')
  async revoke(@Param('membershipId') membershipId: string, @Param('roleId') roleId: string) {
    await this.orchestrator.revoke(currentActor(), membershipId, roleId);
    return { ok: true };
  }
}
