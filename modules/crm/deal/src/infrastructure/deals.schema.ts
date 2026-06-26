import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

import { pipelines } from './pipelines.schema';
import { pipelineStages } from './pipeline-stages.schema';

/**
 * A revenue opportunity for a specific Account, moving through a Pipeline (RFC-002 §2.2/§6.1) —
 * the unit of forecasting. The word is **Deal**, never "opportunity"/"job" (§2.1). Workspace-scoped
 * (§2.3). `pipeline_id`/`stage_id` are same-module FKs; `account_id`/`primary_contact_id` are
 * **cross-module** (account module) → no `.references()` here, FKs hand-written in
 * db/migrations/0008 (CLAUDE.md §17). Stage transitions are guarded domain ops appending
 * `deal_stage_history` (Phase 3). The board index avoids COUNT/SUM on the hot path (§6.3).
 */
export const deals = pgTable(
  'deals',
  {
    ...tenantBaseColumns,
    workspaceId: uuid('workspace_id').notNull(),
    accountId: uuid('account_id').notNull(),
    primaryContactId: uuid('primary_contact_id'),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => pipelineStages.id),
    amount: numeric('amount', { precision: 19, scale: 4 }),
    currency: text('currency'),
    expectedCloseDate: date('expected_close_date'),
    ownerPrincipalId: uuid('owner_principal_id'),
    closeReason: text('close_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    customFields: jsonb('custom_fields').notNull().default({}),
  },
  (t) => [
    index('deals_board_idx')
      .on(t.organizationId, t.workspaceId, t.pipelineId, t.stageId)
      .where(sql`deleted_at is null`),
    index('deals_org_ws_created_id_idx').on(
      t.organizationId,
      t.workspaceId,
      t.createdAt,
      t.id,
    ),
    index('deals_org_account_idx').on(t.organizationId, t.accountId),
    index('deals_org_owner_idx')
      .on(t.organizationId, t.ownerPrincipalId)
      .where(sql`deleted_at is null`),
  ],
);
