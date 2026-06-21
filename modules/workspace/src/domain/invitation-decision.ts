/**
 * Pure, I/O-free decision for whether a presented invitation can be accepted (CLAUDE.md §6
 * Phase 3 — invite → accept → membership). Keeping it free of DB/clock access makes the
 * status/expiry rules unit-testable in isolation; the service supplies the record and the clock.
 *
 * A missing or non-pending invitation collapses to `invalid` so the service can return 404
 * uniformly — never confirming whether a token existed (§3.8).
 */
export interface InvitationState {
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: Date;
}

export type InvitationDecision =
  | { kind: 'acceptable' }
  | { kind: 'expired' }
  | { kind: 'invalid' };

export function decideInvitation(
  invitation: InvitationState | null,
  now: Date,
): InvitationDecision {
  if (!invitation || invitation.status !== 'pending') {
    return { kind: 'invalid' };
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'expired' };
  }
  return { kind: 'acceptable' };
}
