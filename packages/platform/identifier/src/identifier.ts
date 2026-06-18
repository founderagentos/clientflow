import { uuidv7 } from 'uuidv7';

/**
 * A UUIDv7 string — the kernel's single primary-key / identifier type.
 * Per CLAUDE.md §2: UUIDv7 only (globally unique, non-enumerable, insert-ordered).
 * Never UUIDv4, never bigserial.
 */
export type Id = string;

/**
 * Generate a new UUIDv7. This is the single source of truth for app-side
 * identifier generation across the platform (CLAUDE.md §4 — platform/identifier).
 */
export function newId(): Id {
  return uuidv7();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if the value is a well-formed UUID string of any version. */
export function isValidId(value: string): boolean {
  return UUID_RE.test(value);
}

/** True if the value is a well-formed UUID whose version nibble is 7. */
export function isUuidV7(value: string): boolean {
  return isValidId(value) && value[14] === '7';
}
