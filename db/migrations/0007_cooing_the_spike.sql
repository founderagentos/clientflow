CREATE TABLE "account_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"relationship_role" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	"size_band" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_principal_id" uuid,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_name" text,
	"last_name" text,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_email_normalized" "citext",
	"title" text,
	"owner_principal_id" uuid,
	"erased_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"type" text NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_type_check" CHECK ("activities"."type" in ('note', 'call', 'email', 'meeting', 'task_event', 'system'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"assignee_principal_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('open', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"data_type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "custom_field_definitions_data_type_check" CHECK ("custom_field_definitions"."data_type" in ('text', 'number', 'date', 'select', 'multiselect', 'boolean'))
);
--> statement-breakpoint
CREATE TABLE "taggables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tag_id" uuid NOT NULL,
	"taggable_type" text NOT NULL,
	"taggable_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"name" text NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "deal_stage_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_in_previous_seconds" integer,
	"actor_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"account_id" uuid NOT NULL,
	"primary_contact_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"amount" numeric(19, 4),
	"currency" text,
	"expected_close_date" date,
	"owner_principal_id" uuid,
	"close_reason" text,
	"closed_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"probability" numeric(3, 2) DEFAULT '0' NOT NULL,
	"category" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "pipeline_stages_category_check" CHECK ("pipeline_stages"."category" in ('open', 'won', 'lost'))
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"merged_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" in ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text,
	"name" text,
	"email" text,
	"email_normalized" "citext",
	"phone_e164" text,
	"domain" text,
	"score" integer,
	"owner_principal_id" uuid,
	"converted_at" timestamp with time zone,
	"converted_account_id" uuid,
	"converted_contact_id" uuid,
	"converted_deal_id" uuid,
	"merged_into_lead_id" uuid,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('new', 'working', 'qualified', 'unqualified'))
);
--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taggables" ADD CONSTRAINT "taggables_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_lead_id_fkey" FOREIGN KEY ("merged_into_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_contacts_org_account_contact_key" ON "account_contacts" USING btree ("organization_id","account_id","contact_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "account_contacts_one_primary_per_account_key" ON "account_contacts" USING btree ("organization_id","account_id") WHERE is_primary and deleted_at is null;--> statement-breakpoint
CREATE INDEX "account_contacts_org_contact_idx" ON "account_contacts" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "accounts_org_ws_created_id_idx" ON "accounts" USING btree ("organization_id","workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "accounts_org_domain_idx" ON "accounts" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE INDEX "accounts_org_owner_idx" ON "accounts" USING btree ("organization_id","owner_principal_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "contacts_org_ws_created_id_idx" ON "contacts" USING btree ("organization_id","workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "contacts_org_primary_email_normalized_idx" ON "contacts" USING btree ("organization_id","primary_email_normalized");--> statement-breakpoint
CREATE INDEX "contacts_org_owner_idx" ON "contacts" USING btree ("organization_id","owner_principal_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "activities_org_subject_idx" ON "activities" USING btree ("organization_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "activities_org_ws_occurred_idx" ON "activities" USING btree ("organization_id","workspace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_org_ws_assignee_status_idx" ON "tasks" USING btree ("organization_id","workspace_id","assignee_principal_id","status");--> statement-breakpoint
CREATE INDEX "tasks_org_due_idx" ON "tasks" USING btree ("organization_id","due_at") WHERE status = 'open' and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_org_ws_entity_key_key" ON "custom_field_definitions" USING btree ("organization_id","workspace_id","entity_type","key") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "taggables_org_tag_target_key" ON "taggables" USING btree ("organization_id","tag_id","taggable_type","taggable_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "taggables_org_target_idx" ON "taggables" USING btree ("organization_id","taggable_type","taggable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_ws_name_key" ON "tags" USING btree ("organization_id","workspace_id","name") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "deal_stage_history_org_deal_entered_idx" ON "deal_stage_history" USING btree ("organization_id","deal_id","entered_at");--> statement-breakpoint
CREATE INDEX "deals_board_idx" ON "deals" USING btree ("organization_id","workspace_id","pipeline_id","stage_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "deals_org_ws_created_id_idx" ON "deals" USING btree ("organization_id","workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "deals_org_account_idx" ON "deals" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "deals_org_owner_idx" ON "deals" USING btree ("organization_id","owner_principal_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_pipeline_position_key" ON "pipeline_stages" USING btree ("organization_id","pipeline_id","position") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_org_ws_name_key" ON "pipelines" USING btree ("organization_id","workspace_id","name") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_one_default_per_ws_key" ON "pipelines" USING btree ("organization_id","workspace_id") WHERE is_default and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_org_idempotency_key_key" ON "import_jobs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "leads_org_ws_created_id_idx" ON "leads" USING btree ("organization_id","workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "leads_org_email_normalized_idx" ON "leads" USING btree ("organization_id","email_normalized");--> statement-breakpoint
CREATE INDEX "leads_org_phone_e164_idx" ON "leads" USING btree ("organization_id","phone_e164");--> statement-breakpoint
CREATE INDEX "leads_org_owner_idx" ON "leads" USING btree ("organization_id","owner_principal_id") WHERE deleted_at is null;