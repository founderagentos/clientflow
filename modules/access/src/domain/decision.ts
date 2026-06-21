/**
 * The PDP's authorization vocabulary (CLAUDE.md §3.9). Default-deny: a principal is permitted
 * only when the requested permission is in their resolved effective set. The query shape is
 * ABAC-ready (carries optional `resourceOwnership`/attributes for a future Cedar/OPA upgrade),
 * but evaluation is pure RBAC for now.
 */
export type DenyReason = 'no_grant' | 'no_context' | 'unknown_permission';

export type Decision = { effect: 'allow' } | { effect: 'deny'; reason: DenyReason };

/** A principal is a human or an AI/automation — authorized identically (§3.2). */
export interface PrincipalRef {
  id: string;
  type: 'user' | 'service_account';
}

export interface AuthorizationQuery {
  principal: PrincipalRef;
  organizationId: string;
  workspaceId: string | null;
  /** Requested `resource.action` permission. */
  permission: string;
  /** ABAC-ready ownership context — unused under RBAC, reserved for the PDP upgrade. */
  resourceOwnership?: { ownerPrincipalId?: string };
}

export const ALLOW: Decision = { effect: 'allow' };

export function deny(reason: DenyReason): Decision {
  return { effect: 'deny', reason };
}

/** Default-deny combinator: allow iff the permission is in the resolved effective set. */
export function decide(query: AuthorizationQuery, effective: ReadonlySet<string>): Decision {
  return effective.has(query.permission) ? ALLOW : deny('no_grant');
}
