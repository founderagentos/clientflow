/**
 * Pure rotation / reuse-detection state machine for refresh tokens (CLAUDE.md §3.12). Kept
 * free of DB and framework so the security-critical decision is unit-testable in isolation;
 * the `refresh.service` performs the I/O (atomic consume, family revoke, token mint) the
 * decision dictates.
 */

export interface SessionSnapshot {
  readonly id: string;
  readonly familyId: string;
  readonly principalId: string;
  /** non-null = already consumed (rotated) or revoked — the theft signal. */
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
}

export type RefreshDecision =
  | { readonly kind: 'rotate'; readonly session: SessionSnapshot }
  | { readonly kind: 'reuse_detected'; readonly familyId: string; readonly presentedSessionId: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'expired' };

/**
 * Decide what a refresh attempt means from the persisted session state alone.
 *
 * - no session for the presented token hash → `not_found` (deny).
 * - session already revoked → a replay of an already-rotated (or logged-out) token. This is
 *   the textbook stolen-token signal: the whole `family_id` must be revoked (`reuse_detected`).
 * - session past its expiry → `expired` (deny; no rotation).
 * - otherwise → `rotate`: consume this session and issue a successor in the same family.
 *
 * Note the ordering: revocation is checked before expiry, so replaying an old token is always
 * surfaced as theft rather than masked as a benign expiry.
 */
export function decideRefresh(session: SessionSnapshot | null, now: Date): RefreshDecision {
  if (!session) {
    return { kind: 'not_found' };
  }
  if (session.revokedAt !== null) {
    return { kind: 'reuse_detected', familyId: session.familyId, presentedSessionId: session.id };
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'expired' };
  }
  return { kind: 'rotate', session };
}
