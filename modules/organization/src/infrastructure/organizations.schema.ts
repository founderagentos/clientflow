import { pgTable, uuid, text, boolean, timestamp, integer, jsonb, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@agentos/identifier';
import { citext } from '@agentos/persistence-kernel';

/**
 * The tenant root (CLAUDE.md §3.1) — every tenant-owned row traces to one of these via
 * organization_id. Auto-provisioned on registration alongside a default workspace and an
 * Owner membership (Phase 2). `data_processing_consent` defaults to false — deny by default
 * (CLAUDE.md §16); `plan_tier_cache` is a denormalized read-model synced from the future
 * Billing context via a consumed `SubscriptionActivated` event, never written here directly.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    slug: citext('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    homeRegion: text('home_region'),
    planTierCache: text('plan_tier_cache'),
    dataProcessingConsent: boolean('data_processing_consent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    uniqueIndex('organizations_slug_key').on(t.slug).where(sql`deleted_at is null`),
    check('organizations_status_check', sql`${t.status} in ('active', 'suspended', 'archived')`),
  ],
);
