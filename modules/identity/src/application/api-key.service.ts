import { Injectable } from '@nestjs/common';
import { newId } from '@agentos/identifier';
import { NotFoundError } from '@agentos/result-errors';
import type { Tx } from '@agentos/persistence-kernel';
import { hashApiKey, mintApiKey } from '../domain/api-key';
import { ServiceAccountsRepository } from '../infrastructure/service-accounts.repository';
import { ApiKeysRepository, type ApiKeyRow } from '../infrastructure/api-keys.repository';
import { ApiKeyLookupRepository } from '../infrastructure/api-key-lookup.repository';

export interface IssuedApiKey {
  apiKeyId: string;
  serviceAccountId: string;
  /** The full secret — surfaced to the caller exactly once, never stored or logged. */
  plaintext: string;
  prefix: string;
  expiresAt: Date | null;
}

export interface AuthenticatedApiKey {
  apiKeyId: string;
  serviceAccountId: string;
  principalId: string;
  organizationId: string;
  workspaceId: string;
}

/**
 * Issues, revokes, and authenticates service-account API keys (CLAUDE.md §3.12/§3.13). Keys are
 * high-entropy secrets stored only as a SHA-256 hash. `authenticate` runs pre-tenant-context via
 * the SECURITY DEFINER lookup and applies pure expiry/revocation checks; lifecycle operations
 * run inside the owning org's tenant transaction (host orchestrator emits the events).
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly serviceAccounts: ServiceAccountsRepository,
    private readonly apiKeys: ApiKeysRepository,
    private readonly lookup: ApiKeyLookupRepository,
  ) {}

  async issue(
    tx: Tx,
    input: { serviceAccountId: string; expiresAt?: Date | null },
  ): Promise<IssuedApiKey> {
    const serviceAccount = await this.serviceAccounts.findById(tx, input.serviceAccountId);
    if (!serviceAccount) {
      throw new NotFoundError('Service account not found');
    }
    const apiKeyId = newId();
    const minted = mintApiKey();
    const expiresAt = input.expiresAt ?? null;
    await this.apiKeys.insert(tx, {
      id: apiKeyId,
      serviceAccountId: input.serviceAccountId,
      keyHash: minted.keyHash,
      prefix: minted.prefix,
      expiresAt,
    });
    return {
      apiKeyId,
      serviceAccountId: input.serviceAccountId,
      plaintext: minted.plaintext,
      prefix: minted.prefix,
      expiresAt,
    };
  }

  async revoke(tx: Tx, input: { apiKeyId: string }): Promise<{ serviceAccountId: string }> {
    const key = await this.apiKeys.findById(tx, input.apiKeyId);
    if (!key) {
      throw new NotFoundError('API key not found');
    }
    await this.apiKeys.revoke(tx, { id: input.apiKeyId, expectedVersion: key.version });
    return { serviceAccountId: key.serviceAccountId };
  }

  async list(tx: Tx, serviceAccountId: string): Promise<ApiKeyRow[]> {
    return this.apiKeys.listByServiceAccount(tx, serviceAccountId);
  }

  /** Resolve a presented plaintext key to its principal, or null if absent/expired/revoked. */
  async authenticate(plaintext: string): Promise<AuthenticatedApiKey | null> {
    const found = await this.lookup.findByKeyHash(hashApiKey(plaintext));
    if (!found || found.revokedAt !== null) {
      return null;
    }
    if (found.expiresAt !== null && found.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return {
      apiKeyId: found.apiKeyId,
      serviceAccountId: found.serviceAccountId,
      principalId: found.principalId,
      organizationId: found.organizationId,
      workspaceId: found.workspaceId,
    };
  }
}
