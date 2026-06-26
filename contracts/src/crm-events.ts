import { z } from 'zod';

/**
 * CRM Core domain events (RFC-002 §9; CLAUDE.md §3.14/§3.15) — PastTense, emitted to the
 * transactional outbox in the same DB transaction as the state change they describe. Each is
 * wrapped in the platform `domainEventEnvelopeSchema` (which carries organization_id, workspace_id,
 * actor_principal_id, correlation_id, causation_id). Payloads carry only non-sensitive identifiers —
 * never raw PII beyond the minimum a consumer needs (§3.20); erasure carries just the contact id.
 *
 * Phase 2 (Account + Contact) ships the account/contact lifecycle, the GDPR/DPDP erasure event, and
 * the account↔contact relationship events. Deal/Lead/Activity events are added in their own phases.
 */
export const CrmEventType = {
  AccountCreated: 'AccountCreated',
  AccountUpdated: 'AccountUpdated',
  AccountDeleted: 'AccountDeleted',
  ContactCreated: 'ContactCreated',
  ContactUpdated: 'ContactUpdated',
  ContactDeleted: 'ContactDeleted',
  ContactErased: 'ContactErased',
  AccountContactLinked: 'AccountContactLinked',
  AccountContactUnlinked: 'AccountContactUnlinked',
  AccountPrimaryContactChanged: 'AccountPrimaryContactChanged',
} as const;

export type CrmEventType = (typeof CrmEventType)[keyof typeof CrmEventType];

/** Aggregate-type labels for the outbox `aggregate_type` column. */
export const CrmAggregateType = {
  Account: 'Account',
  Contact: 'Contact',
} as const;

export const accountCreatedPayload = z.object({
  accountId: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
});

export const accountUpdatedPayload = z.object({
  accountId: z.string(),
  /** Names of the fields that changed in this update (e.g. ['name', 'industry']). */
  changed: z.array(z.string()),
});

export const accountDeletedPayload = z.object({
  accountId: z.string(),
});

export const contactCreatedPayload = z.object({
  contactId: z.string(),
  /** Set when the contact was created already linked to an account (one-tx create). */
  accountId: z.string().nullable(),
});

export const contactUpdatedPayload = z.object({
  contactId: z.string(),
  changed: z.array(z.string()),
});

export const contactDeletedPayload = z.object({
  contactId: z.string(),
});

export const contactErasedPayload = z.object({
  contactId: z.string(),
});

export const accountContactLinkedPayload = z.object({
  accountId: z.string(),
  contactId: z.string(),
  relationshipRole: z.string().nullable(),
  isPrimary: z.boolean(),
});

export const accountContactUnlinkedPayload = z.object({
  accountId: z.string(),
  contactId: z.string(),
});

export const accountPrimaryContactChangedPayload = z.object({
  accountId: z.string(),
  contactId: z.string(),
  previousPrimaryContactId: z.string().nullable(),
});

export type AccountCreatedPayload = z.infer<typeof accountCreatedPayload>;
export type AccountUpdatedPayload = z.infer<typeof accountUpdatedPayload>;
export type AccountDeletedPayload = z.infer<typeof accountDeletedPayload>;
export type ContactCreatedPayload = z.infer<typeof contactCreatedPayload>;
export type ContactUpdatedPayload = z.infer<typeof contactUpdatedPayload>;
export type ContactDeletedPayload = z.infer<typeof contactDeletedPayload>;
export type ContactErasedPayload = z.infer<typeof contactErasedPayload>;
export type AccountContactLinkedPayload = z.infer<typeof accountContactLinkedPayload>;
export type AccountContactUnlinkedPayload = z.infer<typeof accountContactUnlinkedPayload>;
export type AccountPrimaryContactChangedPayload = z.infer<
  typeof accountPrimaryContactChangedPayload
>;
