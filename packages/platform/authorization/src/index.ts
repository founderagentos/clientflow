/**
 * The authorization port (CLAUDE.md §3.9, RFC-002 §8.2) — the seam a product module uses to enforce
 * the centralized PDP at its **service layer** (defense-in-depth layer 2: API guard → service PDP →
 * RLS) without importing the kernel `access` module (§17). The host binds {@link AUTHORIZATION} to an
 * adapter over the real `PolicyDecisionPoint`; modules depend only on this platform interface.
 *
 * Authorization is identical for humans and `service_account` principals (§3.2) — `principal.type` is
 * carried for audit/attribution, never to branch the decision.
 */

export interface AuthzPrincipal {
  id: string;
  type: 'user' | 'service_account';
}

/** Owner/assignee of the specific resource being acted on (RFC §8.2 intra-tenant least privilege). */
export interface ResourceOwnership {
  ownerPrincipalId?: string | null;
  assigneePrincipalId?: string | null;
}

export interface AuthorizationQuery {
  principal: AuthzPrincipal;
  organizationId: string;
  workspaceId: string;
  /** The requested `resource.action` permission, e.g. `deal.update`. */
  permission: string;
  /**
   * The resource family for ownership/scope checks, e.g. `deal`. Required for ownership-narrowed ops;
   * omit for coarse, permission-only ops (create, config). When present with {@link resourceOwnership}
   * the adapter narrows the decision to owner/assignee-or-manager.
   */
  resource?: string;
  resourceOwnership?: ResourceOwnership;
}

/** Query for the list-scope decision: may this principal see all rows of `resource`, or only own? */
export interface ScopeQuery {
  principal: AuthzPrincipal;
  organizationId: string;
  workspaceId: string;
  resource: string;
}

/** Whether a list read is unrestricted (`all`) or must be filtered to the principal's own rows. */
export type OwnershipScope = 'all' | 'own';

export interface AuthorizationPort {
  /**
   * Authorize a single action, or throw `ForbiddenError` (403). Enforces the `permission`
   * (default-deny); when `resource` + `resourceOwnership` are supplied, additionally requires the
   * principal to be the owner/assignee, or a manager of the resource.
   */
  authorize(query: AuthorizationQuery): Promise<void>;

  /** Resolve whether a principal may list all rows of `resource` or only its own (RFC §8.2). */
  scope(query: ScopeQuery): Promise<OwnershipScope>;
}

/**
 * DI token for the {@link AuthorizationPort} (bound to a PDP-backed adapter at the host). A **string**
 * token (not a Symbol) so it stays reference-stable across module-evaluation boundaries — the provider
 * (host app) and the consumers (CRM library modules) must resolve the identical token, and a Symbol
 * would differ if this module is evaluated in more than one transform context.
 */
export const AUTHORIZATION = 'agentos.authorization' as const;

/** The minimal actor shape the helpers read — every CRM module's actor satisfies it structurally. */
export interface ActorLike {
  principalId: string;
  organizationId: string;
  workspaceId: string;
  principalType?: 'user' | 'service_account';
}

/**
 * Authorize a single CRM command via the {@link AuthorizationPort} — the one-liner every service
 * command calls. Pass `resource` + `ownerPrincipalId` to narrow an op on a specific owned record to
 * owner-or-manager (RFC §8.2); omit them for coarse, permission-only ops (create, config).
 */
export async function authorizeCommand(
  authz: AuthorizationPort,
  actor: ActorLike,
  permission: string,
  ownership?: { resource: string; ownerPrincipalId?: string | null },
): Promise<void> {
  await authz.authorize({
    principal: { id: actor.principalId, type: actor.principalType ?? 'user' },
    organizationId: actor.organizationId,
    workspaceId: actor.workspaceId,
    permission,
    ...(ownership
      ? {
          resource: ownership.resource,
          resourceOwnership: { ownerPrincipalId: ownership.ownerPrincipalId ?? null },
        }
      : {}),
  });
}

/**
 * Resolve the owner filter for a list read: `undefined` (the principal manages the resource → see
 * all) or the principal's own id (narrowed to own rows). The caller must still have authorized the
 * coarse `<resource>.read` permission separately.
 */
export async function ownerListFilter(
  authz: AuthorizationPort,
  actor: ActorLike,
  resource: string,
): Promise<string | undefined> {
  const scope = await authz.scope({
    principal: { id: actor.principalId, type: actor.principalType ?? 'user' },
    organizationId: actor.organizationId,
    workspaceId: actor.workspaceId,
    resource,
  });
  return scope === 'own' ? actor.principalId : undefined;
}
