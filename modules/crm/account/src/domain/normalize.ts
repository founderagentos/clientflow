/**
 * Dedup-signal normalizers (RFC-002 §6.2). These produce the *normalized* forms stored alongside the
 * raw values (`primary_email_normalized`, lowercased account `domain`). They are signals for the
 * Phase-4 matching service — never unique constraints, since real import data is legitimately
 * duplicated. Phone→E.164 normalization is Phase 4 (needs libphonenumber; contacts carry no
 * phone-normalized column).
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
