import { randomBytes, createHash } from 'node:crypto';

/** 256 bits of entropy — opaque, unguessable machine credential (CLAUDE.md §3.12). */
const API_KEY_BYTES = 32;
const API_KEY_PREFIX = 'sk_';
/** Non-secret display fragment stored alongside the hash: `sk_` + 8 chars. */
const PREFIX_DISPLAY_LENGTH = API_KEY_PREFIX.length + 8;

export interface MintedApiKey {
  /** The full secret — returned to the caller exactly once, never stored. */
  plaintext: string;
  /** SHA-256 hex of the plaintext — the only form persisted (`api_keys.key_hash`). */
  keyHash: string;
  /** Short non-secret prefix for display/identification in listings. */
  prefix: string;
}

/**
 * Mint a fresh API key. Like the refresh token (domain/refresh-token.ts), it is high-entropy
 * random — not derived from any user secret — so SHA-256 is the correct at-rest protection;
 * Argon2id is reserved for low-entropy passwords (CLAUDE.md §3.13, never custom crypto).
 */
export function mintApiKey(): MintedApiKey {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('base64url')}`;
  return {
    plaintext,
    keyHash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, PREFIX_DISPLAY_LENGTH),
  };
}

/** SHA-256 hex of an API key. Only the hash is ever stored or looked up. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}
