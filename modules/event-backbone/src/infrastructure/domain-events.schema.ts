import { pgTable, uuid, text, integer, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@agentos/identifier';

/**
 * The transactional outbox (CLAUDE.md §3.14) — every state change writes its event here in
 * the same DB transaction. A relay polls unpublished rows and publishes to the broker,
 * marking them published. Append-only: no updated_at/deleted_at/version (CLAUDE.md §5); the
 * relay only ever sets published_at/status on an existing row. `actor_principal_id` is
 * NOT NULL — every committed event carries a definite actor (matches the
 * `@agentos/contracts` envelope's non-nullable `actorPrincipalId`, CLAUDE.md §3.15), unlike
 * `audit_log_entries` which permits actor-less entries. `actor_principal_id → principals.id`
 * FK is added in db/migrations/0002 (cross-module, CLAUDE.md §17). Partition-ready (not yet
 * partitioned — RFC §9.6) by `occurred_at`.
 */
export const domainEvents = pgTable(
  'domain_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: uuid('organization_id').notNull(),
    /** null = org-scoped event. */
    workspaceId: uuid('workspace_id'),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull().default(1),
    actorPrincipalId: uuid('actor_principal_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    causationId: text('causation_id'),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
  },
  (t) => [
    index('domain_events_unpublished_idx')
      .on(t.status, t.occurredAt)
      .where(sql`published_at is null`),
    index('domain_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
    check('domain_events_status_check', sql`${t.status} in ('pending', 'published', 'failed')`),
  ],
);
