import { z } from 'zod';

/**
 * CRM `lead` context domain events (RFC-002 §9; CLAUDE.md §3.14/§3.15) — PastTense, emitted to the
 * transactional outbox in the same DB transaction as the state change. Covers the top-of-funnel
 * lifecycle, merge, and conversion. Payloads carry only non-sensitive identifiers — never raw PII
 * (no email/phone/name) beyond the minimum a consumer needs (§3.20), matching `ContactCreatedPayload`'s
 * minimalism. `LeadImported` (bulk import) is Phase 4b.
 */
export const LeadEventType = {
  LeadCreated: 'LeadCreated',
  LeadUpdated: 'LeadUpdated',
  LeadStatusChanged: 'LeadStatusChanged',
  LeadAssigned: 'LeadAssigned',
  LeadsMerged: 'LeadsMerged',
  LeadConverted: 'LeadConverted',
} as const;

export type LeadEventType = (typeof LeadEventType)[keyof typeof LeadEventType];

/** Aggregate-type label for the outbox `aggregate_type` column. */
export const LeadAggregateType = {
  Lead: 'Lead',
} as const;

export const LeadStatus = {
  New: 'new',
  Working: 'working',
  Qualified: 'qualified',
  Unqualified: 'unqualified',
} as const;

export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

const leadStatusSchema = z.enum([
  LeadStatus.New,
  LeadStatus.Working,
  LeadStatus.Qualified,
  LeadStatus.Unqualified,
]);

export const leadCreatedPayload = z.object({
  leadId: z.string(),
  status: leadStatusSchema,
});

export const leadUpdatedPayload = z.object({
  leadId: z.string(),
  /** Names of the fields that changed in this update (e.g. ['name', 'source']). */
  changed: z.array(z.string()),
});

export const leadStatusChangedPayload = z.object({
  leadId: z.string(),
  fromStatus: leadStatusSchema,
  toStatus: leadStatusSchema,
});

export const leadAssignedPayload = z.object({
  leadId: z.string(),
  ownerPrincipalId: z.string().nullable(),
  previousOwnerPrincipalId: z.string().nullable(),
});

export const leadsMergedPayload = z.object({
  survivorId: z.string(),
  mergedId: z.string(),
});

export const leadConvertedPayload = z.object({
  leadId: z.string(),
  accountId: z.string(),
  contactId: z.string(),
  dealId: z.string(),
});

export type LeadCreatedPayload = z.infer<typeof leadCreatedPayload>;
export type LeadUpdatedPayload = z.infer<typeof leadUpdatedPayload>;
export type LeadStatusChangedPayload = z.infer<typeof leadStatusChangedPayload>;
export type LeadAssignedPayload = z.infer<typeof leadAssignedPayload>;
export type LeadsMergedPayload = z.infer<typeof leadsMergedPayload>;
export type LeadConvertedPayload = z.infer<typeof leadConvertedPayload>;
