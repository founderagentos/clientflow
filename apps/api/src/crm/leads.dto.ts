import { z } from 'zod';
import { LeadStatus } from '@agentos/contracts';
import type { LeadRow } from '@agentos/crm-lead';

/**
 * Edge validation + response shaping for `/api/v1/leads` (RFC-002 §7) — top-of-funnel, dedup-prone,
 * convertible exactly once. `phone` is raw input (normalized to E.164 server-side, no raw column).
 * Status changes go through the guarded `:id/status-changes` action; conversion + merge are their own
 * action sub-resources. No DELETE — a lead ends via merge or a terminal status (crm.md).
 */

const jsonObject = z.record(z.string(), z.unknown());
const leadStatus = z.enum([
  LeadStatus.New,
  LeadStatus.Working,
  LeadStatus.Qualified,
  LeadStatus.Unqualified,
]);

export const createLeadBodySchema = z.object({
  status: leadStatus.optional(),
  source: z.string().trim().max(120).nullish(),
  name: z.string().trim().max(200).nullish(),
  email: z.string().trim().max(320).nullish(),
  phone: z.string().trim().max(40).nullish(),
  domain: z.string().trim().max(255).nullish(),
  ownerPrincipalId: z.string().uuid().nullish(),
  customFields: jsonObject.optional(),
});

export const updateLeadBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  source: z.string().trim().max(120).nullish(),
  name: z.string().trim().max(200).nullish(),
  email: z.string().trim().max(320).nullish(),
  phone: z.string().trim().max(40).nullish(),
  domain: z.string().trim().max(255).nullish(),
  score: z.number().int().nullish(),
  customFields: jsonObject.optional(),
});

export const assignLeadBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  ownerPrincipalId: z.string().uuid().nullable(),
});

export const statusChangeBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  status: leadStatus,
});

export const mergeLeadBodySchema = z.object({
  mergedId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
});

export function toLeadView(row: LeadRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    status: row.status,
    source: row.source,
    name: row.name,
    email: row.email,
    emailNormalized: row.emailNormalized,
    phoneE164: row.phoneE164,
    domain: row.domain,
    score: row.score,
    ownerPrincipalId: row.ownerPrincipalId,
    convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
    convertedAccountId: row.convertedAccountId,
    convertedContactId: row.convertedContactId,
    convertedDealId: row.convertedDealId,
    mergedIntoLeadId: row.mergedIntoLeadId,
    customFields: row.customFields,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
