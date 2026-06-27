import { z } from 'zod';
import type { AccountRow } from '@agentos/crm-account';

/**
 * Edge validation + response shaping for `/api/v1/accounts` (RFC-002 §7). Zod at the boundary
 * (CLAUDE.md §2); the view mapper never leaks columns the API does not own. **Account ≠ Organization**
 * (crm.md) — this is a business the tenant sells to.
 */

const jsonObject = z.record(z.string(), z.unknown());

export const createAccountBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(255).nullish(),
  industry: z.string().trim().max(120).nullish(),
  sizeBand: z.string().trim().max(40).nullish(),
  address: jsonObject.optional(),
  ownerPrincipalId: z.string().uuid().nullish(),
  customFields: jsonObject.optional(),
});

export const updateAccountBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(200).optional(),
  domain: z.string().trim().max(255).nullish(),
  industry: z.string().trim().max(120).nullish(),
  sizeBand: z.string().trim().max(40).nullish(),
  address: jsonObject.optional(),
  ownerPrincipalId: z.string().uuid().nullish(),
  customFields: jsonObject.optional(),
});

export const linkContactBodySchema = z.object({
  contactId: z.string().uuid(),
  relationshipRole: z.string().trim().max(80).nullish(),
  isPrimary: z.boolean().optional(),
});

export function toAccountView(row: AccountRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    sizeBand: row.sizeBand,
    address: row.address,
    ownerPrincipalId: row.ownerPrincipalId,
    customFields: row.customFields,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
