import { pgTable, uuid, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { newId } from '@agentos/identifier';
import { appendOnlyTimestamp } from '@agentos/persistence-kernel';

import { deals } from './deals.schema';
import { pipelineStages } from './pipeline-stages.schema';

/**
 * Immutable record of every Deal stage transition (RFC-002 §2.2/§6.1) — the source of truth for
 * velocity/forecasting. **Append-only** (CLAUDE.md §5): no updated_at/deleted_at/version; INSERT +
 * SELECT grant only (db/policies/051-crm-grants.sql); its gate-7 immutability test lands in Phase 3.
 * Workspace-scoped (§2.3). `deal_id`/`from_stage_id`/`to_stage_id` are same-module FKs; org/
 * workspace/actor cross-module FKs in db/migrations/0008. Partition-ready by `entered_at` monthly
 * (not yet partitioned — §6.3), mirroring audit_log_entries/domain_events.
 */
export const dealStageHistory = pgTable(
  'deal_stage_history',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    fromStageId: uuid('from_stage_id').references(() => pipelineStages.id),
    toStageId: uuid('to_stage_id')
      .notNull()
      .references(() => pipelineStages.id),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    durationInPreviousSeconds: integer('duration_in_previous_seconds'),
    actorPrincipalId: uuid('actor_principal_id'),
    ...appendOnlyTimestamp,
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    index('deal_stage_history_org_deal_entered_idx').on(
      t.organizationId,
      t.dealId,
      t.enteredAt,
    ),
  ],
);
