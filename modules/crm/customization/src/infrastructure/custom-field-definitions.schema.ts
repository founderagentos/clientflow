import { pgTable, text, boolean, jsonb, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantBaseColumns } from '@agentos/persistence-kernel';

/**
 * Per-workspace typed schema extension (RFC-002 §2.2/§6.1) — governs the inline `custom_fields`
 * jsonb on each business entity (this is the definition catalog; values live inline on the entity,
 * **not** EAV — §11). Configuration — workspace_id nullable (§2.3). Unique per
 * (org, workspace, entity_type, key). Cross-module FKs in db/migrations/0008.
 */
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    ...tenantBaseColumns,
    entityType: text('entity_type').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    dataType: text('data_type').notNull(),
    options: jsonb('options').notNull().default([]),
    isRequired: boolean('is_required').notNull().default(false),
    validation: jsonb('validation').notNull().default({}),
  },
  (t) => [
    uniqueIndex('custom_field_definitions_org_ws_entity_key_key')
      .on(t.organizationId, t.workspaceId, t.entityType, t.key)
      .where(sql`deleted_at is null`),
    check(
      'custom_field_definitions_data_type_check',
      sql`${t.dataType} in ('text', 'number', 'date', 'select', 'multiselect', 'boolean')`,
    ),
  ],
);
