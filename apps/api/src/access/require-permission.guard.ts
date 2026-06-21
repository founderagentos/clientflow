import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnauthenticatedError } from '@agentos/result-errors';
import { getTenantContext } from '@agentos/tenant-context';
import { PolicyDecisionPoint } from '@agentos/access';
import { REQUIRE_PERMISSION } from './require-permission.decorator';

/**
 * Layer 1 of defense-in-depth authorization (CLAUDE.md §3.9 — API guard → service-layer PDP
 * check → database RLS). Resolves the `@RequirePermission` metadata and asks the centralized,
 * default-deny PDP whether the ambient principal may perform each action in the active tenant.
 *
 * Identity comes from the ambient TenantContext (bound by the auth middlewares for both bearer
 * users and API-key service accounts), not `request.auth` — the same reason the membership guard
 * reads ALS under Fastify. A missing context is a 401; a denied permission surfaces as 403 from
 * the PDP. Authorizing users and service accounts through this one path satisfies gate §7.3.
 */
@Injectable()
export class RequirePermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly pdp: PolicyDecisionPoint,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions =
      this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (permissions.length === 0) {
      return true;
    }

    const ctx = getTenantContext();
    if (!ctx) {
      throw new UnauthenticatedError();
    }

    for (const permission of permissions) {
      await this.pdp.authorizeOrThrow({
        principal: { id: ctx.principal.id, type: ctx.principal.type },
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        permission,
      });
    }
    return true;
  }
}
