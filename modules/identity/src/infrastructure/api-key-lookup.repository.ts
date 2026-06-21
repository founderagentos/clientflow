import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database, type Executor } from '@agentos/persistence-kernel';

export interface ApiKeyLookup {
  apiKeyId: string;
  serviceAccountId: string;
  /** Equals `serviceAccountId` — the service account is a shared-PK specialization of principals. */
  principalId: string;
  organizationId: string;
  workspaceId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Pre-auth API-key lookup by hash. A caller presenting an API key has no tenant context yet, and
 * `api_keys` is RLS-protected — the same chicken-and-egg as auth-time membership resolution and
 * invitation acceptance. This calls the SECURITY DEFINER function `auth_api_key_by_hash(text)`
 * (db/policies/042-api-key-functions.sql), owned by the BYPASSRLS role, which performs one narrow
 * read keyed by the unguessable key hash and joins to `service_accounts` to resolve the owning
 * principal/org/workspace. It never widens visibility, so cross-tenant isolation is preserved
 * (CLAUDE.md §7 gate 1). The host uses the returned org/workspace to bind the request's
 * TenantContext as a `service_account` principal.
 */
@Injectable()
export class ApiKeyLookupRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByKeyHash(keyHash: string, executor: Executor = this.db): Promise<ApiKeyLookup | null> {
    const rows = (await executor.execute(
      sql`select api_key_id, service_account_id, principal_id, organization_id, workspace_id, expires_at, revoked_at from auth_api_key_by_hash(${keyHash})`,
    )) as unknown as Array<{
      api_key_id: string;
      service_account_id: string;
      principal_id: string;
      organization_id: string;
      workspace_id: string;
      expires_at: string | Date | null;
      revoked_at: string | Date | null;
    }>;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      apiKeyId: row.api_key_id,
      serviceAccountId: row.service_account_id,
      principalId: row.principal_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
      revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
    };
  }
}
