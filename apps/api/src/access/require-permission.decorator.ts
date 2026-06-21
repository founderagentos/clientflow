import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key carrying the permissions a route requires. */
export const REQUIRE_PERMISSION = 'require_permission';

/**
 * Declares the `resource.action` permission(s) a route requires (CLAUDE.md §3.9). Multiple keys
 * are ANDed — the principal must hold every one. Enforced by {@link RequirePermissionGuard}, which
 * resolves the decision through the centralized PDP (never from the access token).
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSION, permissions);
