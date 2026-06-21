import { Controller, Delete, Param, UseGuards } from '@nestjs/common';
import { currentActor } from '../tenancy/tenancy-actor';
import { RequirePermissionGuard } from './require-permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { ApiKeyOrchestrator } from './api-key.orchestrator';

/** API-key revocation (`/api/v1/api-keys/:id`, CLAUDE.md §3.12). Guarded by `api_key.revoke`. */
@Controller('api-keys')
@UseGuards(RequirePermissionGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyOrchestrator) {}

  @Delete(':id')
  @RequirePermission('api_key.revoke')
  async revoke(@Param('id') id: string) {
    await this.apiKeys.revoke(currentActor(), id);
    return { ok: true };
  }
}
