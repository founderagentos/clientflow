import { z } from 'zod';
import type { ContactRow } from '@agentos/crm-account';

/**
 * Edge validation + response shaping for `/api/v1/contacts` (RFC-002 §7). Holds PII. **Contact ≠
 * User/Principal** (crm.md) — a Contact never authenticates. `emails[0]` is the primary (drives the
 * normalized dedup signal). `erase` (§8.4) is the sensitive GDPR/DPDP path.
 */

const jsonObject = z.record(z.string(), z.unknown());

export const createContactBodySchema = z.object({
  firstName: z.string().trim().max(120).nullish(),
  lastName: z.string().trim().max(120).nullish(),
  emails: z.array(z.string().trim().max(320)).optional(),
  phones: z.array(z.string().trim().max(40)).optional(),
  title: z.string().trim().max(120).nullish(),
  ownerPrincipalId: z.string().uuid().nullish(),
  customFields: jsonObject.optional(),
});

export const updateContactBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  firstName: z.string().trim().max(120).nullish(),
  lastName: z.string().trim().max(120).nullish(),
  emails: z.array(z.string().trim().max(320)).optional(),
  phones: z.array(z.string().trim().max(40)).optional(),
  title: z.string().trim().max(120).nullish(),
  ownerPrincipalId: z.string().uuid().nullish(),
  customFields: jsonObject.optional(),
});

export function toContactView(row: ContactRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    firstName: row.firstName,
    lastName: row.lastName,
    emails: row.emails,
    phones: row.phones,
    primaryEmailNormalized: row.primaryEmailNormalized,
    title: row.title,
    ownerPrincipalId: row.ownerPrincipalId,
    erasedAt: row.erasedAt ? row.erasedAt.toISOString() : null,
    customFields: row.customFields,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
