-- CRM Core RLS (RFC-002 §6) — every CRM table is ENABLE + FORCE row-level security with a
-- tenant_isolation policy enforcing org AND active-workspace. FORCE matters: migrations run as the
-- table owner, who would otherwise bypass the policy (the gate test proves this against a
-- non-superuser owner). DROP POLICY IF EXISTS first for idempotent re-runs.
--
-- Workspace hardening: withTenantTransaction sets app.current_workspace_id to '' (empty string) for
-- org-scoped units of work. NULLIF(..., '') turns that into NULL so:
--   * workspace-scoped rows (workspace_id NOT NULL) are hidden when no workspace is active, and
--   * `''::uuid` is never evaluated (which would raise invalid-uuid).
-- Org-scoped config rows (workspace_id IS NULL — pipelines/stages/tags/custom-field defs that have
-- not been promoted) stay visible under any active workspace in the org.

-- leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leads;
CREATE POLICY tenant_isolation ON leads
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- import_jobs
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON import_jobs;
CREATE POLICY tenant_isolation ON import_jobs
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- accounts
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON accounts;
CREATE POLICY tenant_isolation ON accounts
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contacts;
CREATE POLICY tenant_isolation ON contacts
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- account_contacts
ALTER TABLE account_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON account_contacts;
CREATE POLICY tenant_isolation ON account_contacts
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- pipelines
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pipelines;
CREATE POLICY tenant_isolation ON pipelines
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- pipeline_stages
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pipeline_stages;
CREATE POLICY tenant_isolation ON pipeline_stages
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- deals
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deals;
CREATE POLICY tenant_isolation ON deals
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- deal_stage_history (append-only; immutability enforced by grants in 051)
ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deal_stage_history;
CREATE POLICY tenant_isolation ON deal_stage_history
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- activities
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON activities;
CREATE POLICY tenant_isolation ON activities
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );
-- System activities (is_system = true) are immutable (RFC-002 §2.2/gate 7). A RESTRICTIVE
-- FOR UPDATE policy is AND-ed with tenant_isolation, so a system row can never be updated (nor
-- soft-deleted, which is an UPDATE of deleted_at) — only user-authored notes are editable.
DROP POLICY IF EXISTS activities_system_immutable ON activities;
CREATE POLICY activities_system_immutable ON activities
  AS RESTRICTIVE FOR UPDATE
  USING (is_system = false);

-- tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tasks;
CREATE POLICY tenant_isolation ON tasks
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- tags
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tags;
CREATE POLICY tenant_isolation ON tags
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- taggables
ALTER TABLE taggables ENABLE ROW LEVEL SECURITY;
ALTER TABLE taggables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON taggables;
CREATE POLICY tenant_isolation ON taggables
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );

-- custom_field_definitions
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON custom_field_definitions;
CREATE POLICY tenant_isolation ON custom_field_definitions
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  );
