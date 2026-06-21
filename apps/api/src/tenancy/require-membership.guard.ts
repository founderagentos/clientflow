import { Injectable, type CanActivate } from '@nestjs/common';
import { ForbiddenError } from '@agentos/result-errors';
import { MembershipService } from '@agentos/workspace';
import { assertAuthenticated } from './tenancy-actor';

/**
 * Combined authentication + interim Phase 3 authorization (CLAUDE.md §6 — "membership grants
 * access, absence denies it"). Asserts a bound tenant context (401 if none) and that the
 * principal still holds an active membership in their token's organization (403 if not). It reads
 * identity from the ambient TenantContext (see {@link assertAuthenticated}), so it does not rely
 * on `request.auth`. This is deliberately org-granular: the `resource.action` permission PDP,
 * Redis cache, and event-driven invalidation are Phase 4. Cross-tenant *resource* invisibility is
 * RLS's job and surfaces as 404 from the handler.
 */
@Injectable()
export class RequireMembershipGuard implements CanActivate {
  constructor(private readonly memberships: MembershipService) {}

  async canActivate(): Promise<boolean> {
    const actor = assertAuthenticated();
    const ok = await this.memberships.hasActiveMembership(actor);
    if (!ok) {
      throw new ForbiddenError('No active membership in this organization');
    }
    return true;
  }
}
