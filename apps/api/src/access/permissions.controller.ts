import { Controller, Get, UseGuards } from '@nestjs/common';
import { currentActor } from '../tenancy/tenancy-actor';
import { RequirePermissionGuard } from './require-permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { RoleManagementOrchestrator } from './role-management.orchestrator';

/** Read-only permission catalog (`/api/v1/permissions`, CLAUDE.md §3.10). */
@Controller('permissions')
@UseGuards(RequirePermissionGuard)
export class PermissionsController {
  constructor(private readonly orchestrator: RoleManagementOrchestrator) {}

  @Get()
  @RequirePermission('role.read')
  async list() {
    return (await this.orchestrator.listPermissions(currentActor())).map((p) => ({
      key: p.key,
      resource: p.resource,
      action: p.action,
      description: p.description,
    }));
  }
}
