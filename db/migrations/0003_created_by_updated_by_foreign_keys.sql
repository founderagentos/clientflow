-- created_by/updated_by → principals.id (CLAUDE.md §3.4) — these columns shipped in migration
-- 0000 via tenantBaseColumns/the organizations columns, but the FK itself was missed when the
-- other cross-module constraints were hand-written in 0001. Same reasoning as 0001 applies:
-- principals is owned by the identity module, so this can't be a Drizzle `.references()` on
-- organizations/workspaces/memberships/invitations/roles/service_accounts without crossing a
-- module boundary (CLAUDE.md §17) — enforced here as raw SQL instead.

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
