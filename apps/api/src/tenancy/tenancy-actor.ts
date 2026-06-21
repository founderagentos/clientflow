import { UnauthenticatedError } from '@agentos/result-errors';
import { getTenantContext, requireTenantContext } from '@agentos/tenant-context';

/**
 * The acting principal + active tenant context the tenancy services expect. Structurally
 * compatible with each module's `*Actor` type (WorkspaceActor / MembershipActor / …), so one
 * helper feeds them all.
 *
 * Resolved from the ambient {@link requireTenantContext} (AsyncLocalStorage), which the host
 * tenant-context middleware binds from the verified access token. We read it from ALS rather than
 * `request.auth` because under Fastify the middleware runs on the raw request and that property
 * does not surface on the `FastifyRequest` a guard/handler sees — whereas the ALS context (the
 * same one the Pino logger injects from) propagates reliably into handlers.
 */
export interface TenancyActor {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  correlationId: string;
}

/** Throws `UnauthenticatedError` (401) when no authenticated context is bound. */
export function currentActor(): TenancyActor {
  const ctx = requireTenantContext();
  return {
    principalId: ctx.principal.id,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    correlationId: ctx.correlationId,
  };
}

/** The authenticated principal id when a valid bearer was presented, else null (public routes). */
export function optionalPrincipalId(): string | null {
  return getTenantContext()?.principal.id ?? null;
}

/** Maps a missing tenant context to a 401 (used by the membership guard). */
export function assertAuthenticated(): TenancyActor {
  const ctx = getTenantContext();
  if (!ctx) {
    throw new UnauthenticatedError();
  }
  return {
    principalId: ctx.principal.id,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    correlationId: ctx.correlationId,
  };
}
