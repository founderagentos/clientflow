import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { assertVersionMatched, nextVersion, type Tx } from '@agentos/persistence-kernel';
import { apiKeys } from './api-keys.schema';

export interface ApiKeyRow {
  id: string;
  serviceAccountId: string;
  prefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  version: number;
}

/**
 * Reads/writes API keys. `api_keys` has no `organization_id` of its own — tenancy is resolved by
 * joining to `service_accounts` (RLS is an EXISTS subquery against that parent, db/policies/
 * 020-policies.sql), so every method runs inside the owning org's tenant transaction. Only the
 * SHA-256 `key_hash` is stored; the plaintext is never persisted. The table uses the
 * global base columns (no `created_by`/`updated_by`), so writes set timestamps directly.
 */
@Injectable()
export class ApiKeysRepository {
  async insert(
    tx: Tx,
    input: {
      id: string;
      serviceAccountId: string;
      keyHash: string;
      prefix: string;
      expiresAt: Date | null;
    },
  ): Promise<void> {
    await tx.insert(apiKeys).values({
      id: input.id,
      serviceAccountId: input.serviceAccountId,
      keyHash: input.keyHash,
      prefix: input.prefix,
      expiresAt: input.expiresAt,
    });
  }

  async findById(tx: Tx, id: string): Promise<ApiKeyRow | null> {
    const [row] = await tx
      .select({
        id: apiKeys.id,
        serviceAccountId: apiKeys.serviceAccountId,
        prefix: apiKeys.prefix,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        version: apiKeys.version,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async listByServiceAccount(tx: Tx, serviceAccountId: string): Promise<ApiKeyRow[]> {
    return tx
      .select({
        id: apiKeys.id,
        serviceAccountId: apiKeys.serviceAccountId,
        prefix: apiKeys.prefix,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        version: apiKeys.version,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.serviceAccountId, serviceAccountId), isNull(apiKeys.deletedAt)))
      .orderBy(apiKeys.createdAt);
  }

  /** Optimistic-locked revoke: mark revoked + soft-delete so the key can never authenticate again. */
  async revoke(tx: Tx, input: { id: string; expectedVersion: number }): Promise<void> {
    const now = new Date();
    const rows = await tx
      .update(apiKeys)
      .set({
        revokedAt: now,
        deletedAt: now,
        updatedAt: now,
        version: nextVersion(input.expectedVersion),
      })
      .where(
        and(
          eq(apiKeys.id, input.id),
          eq(apiKeys.version, input.expectedVersion),
          isNull(apiKeys.deletedAt),
        ),
      )
      .returning({ id: apiKeys.id });
    assertVersionMatched(rows.length);
  }
}
