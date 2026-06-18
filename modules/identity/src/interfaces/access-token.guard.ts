import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '@agentos/result-errors';
import type { AuthContext, RequestWithAuth } from './auth-context';

/**
 * Guards routes that require a valid access token. The token is verified and `request.auth` is
 * populated upstream by the tenant-context middleware (single verification per request); this
 * guard only asserts its presence. It performs NO permission checks — default-deny
 * authorization (the PDP) is Phase 4 (CLAUDE.md §6).
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!request.auth) {
      throw new UnauthenticatedError();
    }
    return true;
  }
}

/** Read the authenticated context off a request, asserting it is present. */
export function requireAuth(request: RequestWithAuth): AuthContext {
  if (!request.auth) {
    throw new UnauthenticatedError();
  }
  return request.auth;
}
