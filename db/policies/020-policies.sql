-- The `tenant_isolation` policy per table (CLAUDE.md §3.6/§3.7). Organization-scoped only —
-- workspace-level filtering is deferred to the Phase 4 PDP/service layer, per the RFC's
-- literal example and CLAUDE.md §7 gate 1. DROP IF EXISTS first for idempotent re-runs
-- (CREATE POLICY has no IF NOT EXISTS).

-- organizations: no organization_id column — its own id IS the tenant key.
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING (id = current_setting('app.current_organization_id')::uuid);

-- Standard shape: a direct organization_id column.
DROP POLICY IF EXISTS tenant_isolation ON workspaces;
CREATE POLICY tenant_isolation ON workspaces
  USING (organization_id = current_setting('app.current_organization_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON memberships;
CREATE POLICY tenant_isolation ON memberships
  USING (organization_id = current_setting('app.current_organization_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON service_accounts;
CREATE POLICY tenant_isolation ON service_accounts
  USING (organization_id = current_setting('app.current_organization_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON invitations;
CREATE POLICY tenant_isolation ON invitations
  USING (organization_id = current_setting('app.current_organization_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON audit_log_entries;
CREATE POLICY tenant_isolation ON audit_log_entries
  USING (organization_id = current_setting('app.current_organization_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON domain_events;
CREATE POLICY tenant_isolation ON domain_events
  USING (organization_id = current_setting('app.current_organization_id')::uuid);

-- roles: system roles (organization_id IS NULL) must stay visible to every tenant.
DROP POLICY IF EXISTS tenant_isolation ON roles;
CREATE POLICY tenant_isolation ON roles
  USING (
    organization_id IS NULL
    OR organization_id = current_setting('app.current_organization_id')::uuid
  );

-- Junction/child tables with no own organization_id — EXISTS subquery against the parent.
DROP POLICY IF EXISTS tenant_isolation ON role_permissions;
CREATE POLICY tenant_isolation ON role_permissions
  USING (
    EXISTS (
      SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
        AND (
          r.organization_id IS NULL
          OR r.organization_id = current_setting('app.current_organization_id')::uuid
        )
    )
  );

DROP POLICY IF EXISTS tenant_isolation ON membership_roles;
CREATE POLICY tenant_isolation ON membership_roles
  USING (
    EXISTS (
      SELECT 1 FROM memberships m WHERE m.id = membership_roles.membership_id
        AND m.organization_id = current_setting('app.current_organization_id')::uuid
    )
  );

DROP POLICY IF EXISTS tenant_isolation ON api_keys;
CREATE POLICY tenant_isolation ON api_keys
  USING (
    EXISTS (
      SELECT 1 FROM service_accounts sa WHERE sa.id = api_keys.service_account_id
        AND sa.organization_id = current_setting('app.current_organization_id')::uuid
    )
  );
