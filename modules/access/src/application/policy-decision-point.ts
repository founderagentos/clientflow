import { Inject, Injectable } from '@nestjs/common';
import { ForbiddenError } from '@agentos/result-errors';
import { DATABASE, withTenantTransaction, type Database } from '@agentos/persistence-kernel';
import {
  decide as evaluateDecision,
  type AuthorizationQuery,
  type Decision,
} from '../domain/decision';
import { computeEffectivePermissions } from '../domain/effective-permissions';
import { MembershipRolesRepository } from '../infrastructure/membership-roles.repository';
import { PERMISSION_CACHE, type PermissionCachePort } from './permission-cache.port';

/**
 * The centralized Policy Decision Point (CLAUDE.md §3.9) — the single, default-deny brain that
 * every authorization check flows through, for humans and service-account principals alike
 * (§3.2). It resolves a principal's effective permission set (cache-first; on a miss it reads
 * the grants under the tenant's RLS scope and computes the set with the pure scope engine), then
 * evaluates the request. Permissions are never read from the access token (§3.10).
 *
 * The PDP owns its read transaction so callers (the API guard and service-layer checks) need
 * not thread one through; on a cache hit no database round trip happens at all.
 */
@Injectable()
export class PolicyDecisionPoint {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly grants: MembershipRolesRepository,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
  ) {}

  async decide(query: AuthorizationQuery): Promise<Decision> {
    const { principal, organizationId, workspaceId } = query;

    let effective = await this.cache.get(principal.id, organizationId, workspaceId);
    if (!effective) {
      effective = await withTenantTransaction(this.db, { organizationId, workspaceId }, async (tx) =>
        computeEffectivePermissions(await this.grants.resolveGrantsForPrincipal(tx, principal.id), {
          workspaceId,
        }),
      );
      await this.cache.set(principal.id, organizationId, workspaceId, effective);
    }

    return evaluateDecision(query, effective);
  }

  /** Authorize or throw 403 — the form used by the API guard and service-layer checks. */
  async authorizeOrThrow(query: AuthorizationQuery): Promise<void> {
    const decision = await this.decide(query);
    if (decision.effect === 'deny') {
      throw new ForbiddenError(`Not permitted: ${query.permission}`);
    }
  }
}
