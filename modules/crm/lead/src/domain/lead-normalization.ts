import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Dedup-signal normalizers (RFC-002 §6.2) — Lead's own copies of the account module's
 * `normalizeEmail`/`normalizeDomain` (modules can't cross-import, CLAUDE.md §17), plus the
 * Phase-4 phone normalizer. All three are *signals* for the conversion matching service — never
 * unique constraints, since real import data is legitimately duplicated.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) {
    return null;
  }
  const normalized = domain.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Parses a raw phone number to E.164 via libphonenumber-js. Returns null for empty/unparseable/
 * invalid input rather than throwing — a bad phone number is a missing dedup signal, not a
 * validation failure (RFC §6.2: dedup is advisory, never a hard constraint).
 */
export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountry?: CountryCode,
): string | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = parsePhoneNumberFromString(raw, defaultCountry);
    return parsed && parsed.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}
