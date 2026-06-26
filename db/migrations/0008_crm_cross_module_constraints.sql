-- Custom SQL migration file, put your code below! --

-- CRM Core cross-module foreign keys + jsonb GIN indexes (RFC-002 §3.3, CLAUDE.md §17).
-- The Drizzle schema layer never imports another module's table object, so every FK that crosses
-- a module boundary is hand-written here (same precedent as db/migrations/0001/0003). Within-module
-- FKs (account_contacts→accounts/contacts, deals→pipelines/stages, etc.) were already emitted by
-- 0007. All FKs are ON DELETE no action — soft delete is the deletion model (§3.4); referential
-- integrity is enforced, cascades are not.

-- organization_id / workspace_id → kernel tenant roots (all 14 CRM tables).
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "taggables" ADD CONSTRAINT "taggables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "taggables" ADD CONSTRAINT "taggables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;

-- Actor/owner/assignee → principals (humans and service accounts alike, CLAUDE.md §2).
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_principal_id_principals_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_principal_id_principals_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_principal_id_principals_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_principal_id_principals_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_actor_principal_id_principals_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_principal_id_principals_id_fk" FOREIGN KEY ("assignee_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;

-- Cross-CRM-module FKs: deal → account/contact (account module); lead conversion pointers →
-- account/contact/deal. These reference rows the deal/lead modules may not import in TypeScript.
ALTER TABLE "deals" ADD CONSTRAINT "deals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deals" ADD CONSTRAINT "deals_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_account_id_accounts_id_fk" FOREIGN KEY ("converted_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_contact_id_contacts_id_fk" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_deal_id_deals_id_fk" FOREIGN KEY ("converted_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;

-- jsonb GIN indexes (RFC-002 §6.3) — fast custom-field filtering on the inline `custom_fields`
-- column. jsonb_path_ops keeps the index compact for the @>/containment queries the filter DSL uses.
CREATE INDEX "leads_custom_fields_gin" ON "leads" USING gin ("custom_fields" jsonb_path_ops);
CREATE INDEX "accounts_custom_fields_gin" ON "accounts" USING gin ("custom_fields" jsonb_path_ops);
CREATE INDEX "contacts_custom_fields_gin" ON "contacts" USING gin ("custom_fields" jsonb_path_ops);
CREATE INDEX "deals_custom_fields_gin" ON "deals" USING gin ("custom_fields" jsonb_path_ops);