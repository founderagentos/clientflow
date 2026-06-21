import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { AccessAggregateType, AccessEventType } from '@agentos/contracts';
import { ApiKeyService, type ApiKeyRow, type IssuedApiKey } from '@agentos/identity';
import type { TenancyActor } from '../tenancy/tenancy-actor';

/**
 * Host orchestration for service-account API keys (CLAUDE.md §3.12). Issue/revoke and their
 * `ApiKeyIssued`/`ApiKeyRevoked` events commit atomically (§3.14). The issued plaintext is
 * surfaced to the caller exactly once and never persisted or logged (§3.20).
 */
@Injectable()
export class ApiKeyOrchestrator {
  constructor(
    private readonly apiKeys: ApiKeyService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  private scope(actor: TenancyActor) {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }

  async issue(
    actor: TenancyActor,
    serviceAccountId: string,
    expiresAt: Date | null,
  ): Promise<IssuedApiKey> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const issued = await this.apiKeys.issue(tx, { serviceAccountId, expiresAt });
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: AccessAggregateType.ApiKey,
        aggregateId: issued.apiKeyId,
        type: AccessEventType.ApiKeyIssued,
        payload: {
          apiKeyId: issued.apiKeyId,
          serviceAccountId,
          expiresAt: issued.expiresAt === null ? null : issued.expiresAt.toISOString(),
        },
      });
      return issued;
    });
  }

  async revoke(actor: TenancyActor, apiKeyId: string): Promise<void> {
    await withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const { serviceAccountId } = await this.apiKeys.revoke(tx, { apiKeyId });
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: AccessAggregateType.ApiKey,
        aggregateId: apiKeyId,
        type: AccessEventType.ApiKeyRevoked,
        payload: { apiKeyId, serviceAccountId },
      });
    });
  }

  async list(actor: TenancyActor, serviceAccountId: string): Promise<ApiKeyRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.apiKeys.list(tx, serviceAccountId),
    );
  }
}
