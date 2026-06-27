import { z } from 'zod';
import type { DealRow } from '@agentos/crm-deal';
import { decimalString } from './crm-http';

/**
 * Edge validation + response shaping for `/api/v1/deals` (RFC-002 §7). The word is **Deal** — never
 * "opportunity"/"job" (crm.md). Money rides as a decimal string (Drizzle numeric ⇄ string). Stage
 * moves go through the `:id/stage-transitions` / `:id/closure` action sub-resources, not PATCH, so the
 * guarded transition (immutable history + terminal close reason) is never bypassed.
 */

const jsonObject = z.record(z.string(), z.unknown());
/** Calendar date `YYYY-MM-DD` (the deal's expected close), version-agnostic regex. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date');

export const createDealBodySchema = z.object({
  accountId: z.string().uuid(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  primaryContactId: z.string().uuid().nullish(),
  amount: decimalString.nullish(),
  currency: z.string().trim().length(3).nullish(),
  expectedCloseDate: isoDate.nullish(),
  ownerPrincipalId: z.string().uuid().nullish(),
  customFields: jsonObject.optional(),
});

export const updateDealBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  amount: decimalString.nullish(),
  currency: z.string().trim().length(3).nullish(),
  expectedCloseDate: isoDate.nullish(),
  primaryContactId: z.string().uuid().nullish(),
  customFields: jsonObject.optional(),
});

export const assignDealBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  ownerPrincipalId: z.string().uuid().nullable(),
});

export const transitionDealBodySchema = z.object({
  toStageId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  closeReason: z.string().trim().max(2000).nullish(),
});

export const closeDealBodySchema = z.object({
  outcome: z.enum(['won', 'lost']),
  closeReason: z.string().trim().min(1).max(2000),
  expectedVersion: z.number().int().nonnegative(),
});

export function toDealView(row: DealRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    accountId: row.accountId,
    primaryContactId: row.primaryContactId,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    amount: row.amount,
    currency: row.currency,
    expectedCloseDate: row.expectedCloseDate,
    ownerPrincipalId: row.ownerPrincipalId,
    closeReason: row.closeReason,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    customFields: row.customFields,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
