import { pgTable, uuid, text, integer, numeric, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

import { pipelines } from './pipelines.schema';

/**
 * An ordered Stage within a Pipeline (RFC-002 §2.2/§6.1). `position` orders the funnel,
 * `probability` is the forecast weight, `category` (open|won|lost) drives terminal-stage rules
 * (Phase 3). Configuration — workspace_id nullable (§2.3). `pipeline_id` is a same-module FK
 * (`.references()`); org/workspace cross-module FKs in db/migrations/0008.
 */
export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    ...tenantBaseColumns,
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    probability: numeric('probability', { precision: 3, scale: 2 }).notNull().default('0'),
    category: text('category').notNull().default('open'),
  },
  (t) => [
    uniqueIndex('pipeline_stages_pipeline_position_key')
      .on(t.organizationId, t.pipelineId, t.position)
      .where(sql`deleted_at is null`),
    check('pipeline_stages_category_check', sql`${t.category} in ('open', 'won', 'lost')`),
  ],
);
