import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** 256 bits of entropy — opaque, unguessable, no structure to leak (mirrors §3.12 refresh tokens). */
const INVITATION_TOKEN_BYTES = 32;

/**
 * Mint a fresh opaque invitation token. High-entropy random (not a JWT, not derived from a user
 * secret), so a fast hash (SHA-256) is the correct at-rest protection — Argon2id is only for
 * low-entropy passwords (CLAUDE.md §3.13, never custom crypto). The plaintext is returned to the
 * inviter exactly once (for the invite link/email) and is never persisted or logged (§3.20).
 */
export function mintInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex of the token. Only the hash is stored (`invitations.token_hash`). */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of a presented token against a stored hash. */
export function invitationTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashInvitationToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
