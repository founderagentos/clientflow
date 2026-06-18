-- Auth-time cross-tenant lookup (CLAUDE.md §3.3 "identity is global; access is contextual").
--
-- A principal's memberships span many organizations, but `memberships` is RLS-protected and
-- login happens BEFORE any tenant context exists — a chicken-and-egg the per-org
-- `tenant_isolation` policy cannot resolve (it would need the org id we are trying to find).
--
-- This SECURITY DEFINER function, owned by the BYPASSRLS `platform_operator` role
-- (db/policies/000-roles.sql), performs exactly one narrow, parameterized read: the *active*
-- memberships of a SINGLE principal — the one that just authenticated. It never widens
-- visibility (a caller can only ever pass a principal id it already holds), so cross-tenant
-- isolation (CLAUDE.md §7 gate 1) is fully preserved. `SET search_path = public` hardens the
-- definer context against search-path hijacking. Reused by the Phase 3 organization switcher.
--
-- Idempotent (CREATE OR REPLACE + idempotent OWNER/GRANT): safe to re-run.

CREATE OR REPLACE FUNCTION auth_principal_memberships(p_principal_id uuid)
RETURNS TABLE (membership_id uuid, organization_id uuid, workspace_id uuid, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.organization_id, m.workspace_id, m.status
  FROM memberships m
  WHERE m.principal_id = p_principal_id
    AND m.deleted_at IS NULL
    AND m.status = 'active'
  ORDER BY m.created_at ASC;
$$;

ALTER FUNCTION auth_principal_memberships(uuid) OWNER TO platform_operator;
REVOKE ALL ON FUNCTION auth_principal_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_principal_memberships(uuid) TO app_user;
