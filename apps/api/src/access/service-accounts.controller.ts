import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { ServiceAccountRow, ApiKeyRow } from '@agentos/identity';
import { currentActor } from '../tenancy/tenancy-actor';
import { RequirePermissionGuard } from './require-permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { ServiceAccountOrchestrator } from './service-account.orchestrator';
import { ApiKeyOrchestrator } from './api-key.orchestrator';
import { archiveBodySchema, createServiceAccountBodySchema, issueApiKeyBodySchema } from './access.dto';

function toServiceAccountView(sa: ServiceAccountRow) {
  return {
    id: sa.id,
    organizationId: sa.organizationId,
    workspaceId: sa.workspaceId,
    name: sa.name,
    kind: sa.kind,
    version: sa.version,
  };
}

function toApiKeyView(key: ApiKeyRow) {
  return {
    id: key.id,
    serviceAccountId: key.serviceAccountId,
    prefix: key.prefix,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    version: key.version,
  };
}

/**
 * Service accounts and their API keys (`/api/v1/service-accounts`, CLAUDE.md §3.2). Creating an
 * account with a `roleId` makes the agent immediately authorizable through the PDP. An issued key
 * is returned in plaintext exactly once (`apiKey`); only its hash is ever stored.
 */
@Controller('service-accounts')
@UseGuards(RequirePermissionGuard)
export class ServiceAccountsController {
  constructor(
    private readonly serviceAccounts: ServiceAccountOrchestrator,
    private readonly apiKeys: ApiKeyOrchestrator,
  ) {}

  @Get()
  @RequirePermission('service_account.read')
  async list() {
    return (await this.serviceAccounts.list(currentActor())).map(toServiceAccountView);
  }

  @Post()
  @RequirePermission('service_account.create')
  async create(@Body() body: unknown) {
    const input = createServiceAccountBodySchema.parse(body);
    return this.serviceAccounts.create(currentActor(), input);
  }

  @Delete(':id')
  @RequirePermission('service_account.delete')
  async archive(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion } = archiveBodySchema.parse(body);
    await this.serviceAccounts.archive(currentActor(), id, expectedVersion);
    return { ok: true };
  }

  @Post(':id/api-keys')
  @RequirePermission('api_key.create')
  async issueKey(@Param('id') id: string, @Body() body: unknown) {
    const { expiresAt } = issueApiKeyBodySchema.parse(body);
    const issued = await this.apiKeys.issue(
      currentActor(),
      id,
      expiresAt !== undefined ? new Date(expiresAt) : null,
    );
    return {
      apiKeyId: issued.apiKeyId,
      serviceAccountId: issued.serviceAccountId,
      apiKey: issued.plaintext,
      prefix: issued.prefix,
      expiresAt: issued.expiresAt,
    };
  }

  @Get(':id/api-keys')
  @RequirePermission('api_key.read')
  async listKeys(@Param('id') id: string) {
    return (await this.apiKeys.list(currentActor(), id)).map(toApiKeyView);
  }
}
