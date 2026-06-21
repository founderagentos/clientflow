-- Accept-time invitation lookup (CLAUDE.md §6 Phase 3 — invite → accept → membership).
--
-- An invitee accepting a link has no tenant context yet, and may have no account at all, but
-- `invitations` is RLS-protected (`organization_id = app.current_organization_id`). This is the
-- same chicken-and-egg as auth-time membership resolution (040-auth-functions.sql): the host
-- must learn the invitation's org/workspace BEFORE it can open the RLS transaction that creates
-- the membership.
--
-- This SECURITY DEFINER function, owned by the BYPASSRLS `platform_operator` role
-- (db/policies/000-roles.sql), performs exactly one narrow, parameterized read keyed by the
-- invitation's SHA-256 token hash — an unguessable 256-bit secret the caller must already hold,
-- so it never widens visibility and cross-tenant isolation (CLAUDE.md §7 gate 1) is preserved.
-- It returns only the fields acceptance needs (no token hash, no internal columns). Soft-deleted
-- (revoked) rows are excluded; status/expiry are returned for the caller's pure decision logic.
-- `SET search_path = public` hardens the definer context against search-path hijacking.
--
-- Idempotent (CREATE OR REPLACE + idempotent OWNER/GRANT): safe to re-run.

CREATE OR REPLACE FUNCTION auth_invitation_by_token_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  workspace_id uuid,
  email text,
  role_id uuid,
  status text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.organization_id, i.workspace_id, i.email::text, i.role_id, i.status, i.expires_at
  FROM invitations i
  WHERE i.token_hash = p_token_hash
    AND i.deleted_at IS NULL;
$$;

ALTER FUNCTION auth_invitation_by_token_hash(text) OWNER TO platform_operator;
REVOKE ALL ON FUNCTION auth_invitation_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_invitation_by_token_hash(text) TO app_user;
