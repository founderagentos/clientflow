/**
 * GDPR/DPDP erasure (RFC-002 §8.4) — distinct from soft delete. Erasure purges the PII columns and
 * sets `erased_at`, leaving a tenant-safe **tombstone**: the row and its FKs survive so Deals,
 * Activities, and `account_contacts` referencing the contact stay structurally valid. `custom_fields`
 * is reset wholesale (`{}`) — per-field PII classification via custom_field_definitions isn't
 * available yet, so the safe choice is to clear all of it.
 */
export interface ContactErasurePatch {
  firstName: null;
  lastName: null;
  title: null;
  emails: string[];
  phones: string[];
  primaryEmailNormalized: null;
  customFields: Record<string, never>;
  erasedAt: Date;
}

export function erasurePatch(now: Date = new Date()): ContactErasurePatch {
  return {
    firstName: null,
    lastName: null,
    title: null,
    emails: [],
    phones: [],
    primaryEmailNormalized: null,
    customFields: {},
    erasedAt: now,
  };
}
