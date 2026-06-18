import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** 256 bits of entropy — opaque, unguessable, no structure to leak (CLAUDE.md §3.12). */
const REFRESH_TOKEN_BYTES = 32;

/**
 * Mint a fresh opaque refresh token. High-entropy random — NOT a JWT and NOT derived from any
 * user secret, so a fast hash (SHA-256) is the correct at-rest protection. Argon2id is for
 * low-entropy passwords; running a memory-hard KDF on every refresh would be pure overhead and
 * a DoS amplifier (CLAUDE.md §3.13 — argon2 for passwords; standard primitives, never custom
 * crypto, for everything else).
 */
export function mintRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex of the token. Only the hash is ever stored (`sessions.refresh_token_hash`). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a presented token against a stored hash. The primary lookup is
 * by hash equality on the unique index (the hash is non-secret, derived data); this guards the
 * rare path where a fetched hash is compared in application code.
 */
export function refreshTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashRefreshToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
