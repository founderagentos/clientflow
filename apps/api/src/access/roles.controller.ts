import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { RoleRow } from '@agentos/access';
import { currentActor } from '../tenancy/tenancy-actor';
import { RequirePermissionGuard } from './require-permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { RoleManagementOrchestrator } from './role-management.orchestrator';
import {
  archiveBodySchema,
  createRoleBodySchema,
  grantPermissionBodySchema,
  renameRoleBodySchema,
} from './access.dto';

function toRoleView(role: RoleRow) {
  return {
    id: role.id,
    organizationId: role.organizationId,
    scope: role.scope,
    name: role.name,
    isSystem: role.isSystem,
    version: role.version,
  };
}

/**
 * Role management (`/api/v1/roles`, CLAUDE.md §19). Every route is guarded by the PDP via
 * `@RequirePermission` (layer 1). System roles are listed but immutable (the service rejects
 * mutation). Permission mapping lives under the nested `:id/permissions` sub-resource.
 */
@Controller('roles')
@UseGuards(RequirePermissionGuard)
export class RolesController {
  constructor(private readonly orchestrator: RoleManagementOrchestrator) {}

  @Get()
  @RequirePermission('role.read')
  async list() {
    return (await this.orchestrator.listRoles(currentActor())).map(toRoleView);
  }

  @Post()
  @RequirePermission('role.create')
  async create(@Body() body: unknown) {
    const input = createRoleBodySchema.parse(body);
    return this.orchestrator.createRole(currentActor(), input);
  }

  @Patch(':id')
  @RequirePermission('role.update')
  async rename(@Param('id') id: string, @Body() body: unknown) {
    const input = renameRoleBodySchema.parse(body);
    await this.orchestrator.renameRole(currentActor(), id, input);
    return { ok: true };
  }

  @Delete(':id')
  @RequirePermission('role.delete')
  async archive(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion } = archiveBodySchema.parse(body);
    await this.orchestrator.archiveRole(currentActor(), id, { expectedVersion });
    return { ok: true };
  }

  @Post(':id/permissions')
  @RequirePermission('role.update')
  async grantPermission(@Param('id') id: string, @Body() body: unknown) {
    const { permissionKey } = grantPermissionBodySchema.parse(body);
    await this.orchestrator.grantPermission(currentActor(), id, permissionKey);
    return { ok: true };
  }

  @Delete(':id/permissions/:permissionKey')
  @RequirePermission('role.update')
  async revokePermission(
    @Param('id') id: string,
    @Param('permissionKey') permissionKey: string,
  ) {
    await this.orchestrator.revokePermission(currentActor(), id, permissionKey);
    return { ok: true };
  }
}
