-- API-key authentication lookup (CLAUDE.md §6 Phase 4 — service accounts authorized by the
-- same PDP as humans, attributed as the actor).
--
-- A caller presenting an API key has no tenant context yet: `api_keys` is RLS-protected via an
-- EXISTS subquery against `service_accounts.organization_id = app.current_organization_id`
-- (db/policies/020-policies.sql), but the host must learn the key's org/workspace BEFORE it can
-- open the RLS transaction. This is the same chicken-and-egg as auth-time membership resolution
-- (040-auth-functions.sql) and invitation acceptance (041-invitation-functions.sql).
--
-- This SECURITY DEFINER function, owned by the BYPASSRLS `platform_operator` role
-- (db/policies/000-roles.sql), performs exactly one narrow, parameterized read keyed by the
-- key's SHA-256 hash — an unguessable 256-bit secret the caller must already hold — and joins to
-- `service_accounts` to resolve the owning principal/org/workspace (api_keys carries no
-- organization_id of its own). It never widens visibility, so cross-tenant isolation
-- (CLAUDE.md §7 gate 1) is preserved. The returned `principal_id` is the service account's id
-- (shared-PK specialization of `principals`). Soft-deleted keys/accounts are excluded; the
-- caller applies pure expiry/revocation decision logic on `expires_at`/`revoked_at`.
-- `SET search_path = public` hardens the definer context against search-path hijacking.
--
-- Idempotent (CREATE OR REPLACE + idempotent OWNER/GRANT): safe to re-run.

CREATE OR REPLACE FUNCTION auth_api_key_by_hash(p_key_hash text)
RETURNS TABLE (
  api_key_id uuid,
  service_account_id uuid,
  principal_id uuid,
  organization_id uuid,
  workspace_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.service_account_id, sa.id AS principal_id,
         sa.organization_id, sa.workspace_id, k.expires_at, k.revoked_at
  FROM api_keys k
  JOIN service_accounts sa ON sa.id = k.service_account_id
  WHERE k.key_hash = p_key_hash
    AND k.deleted_at IS NULL
    AND sa.deleted_at IS NULL;
$$;

ALTER FUNCTION auth_api_key_by_hash(text) OWNER TO platform_operator;
REVOKE ALL ON FUNCTION auth_api_key_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_api_key_by_hash(text) TO app_user;
