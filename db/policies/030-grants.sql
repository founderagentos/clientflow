-- Base table privileges. RLS policies decide *which rows*; these GRANTs decide whether a
-- role can touch the table at all (BYPASSRLS skips the policy check, not the grant check —
-- platform_operator still needs SELECT here).

GRANT USAGE ON SCHEMA public TO app_user, platform_operator;

-- app_user: SELECT, INSERT, UPDATE everywhere. No DELETE — the standard column contract uses
-- soft delete (deleted_at), so app code never issues a real DELETE (CLAUDE.md §3.4).
GRANT SELECT, INSERT, UPDATE ON
  organizations,
  workspaces,
  memberships,
  roles,
  role_permissions,
  membership_roles,
  service_accounts,
  api_keys,
  invitations,
  domain_events,
  principals,
  users,
  identities,
  sessions,
  permissions
TO app_user;

-- role_permissions and membership_roles are bare junction tables (CLAUDE.md §5) — they carry no
-- deleted_at, so revoking a grant is a genuine row DELETE, not a soft delete. This is the only
-- place app_user is permitted to DELETE; RLS still scopes which rows are visible to delete.
GRANT DELETE ON role_permissions, membership_roles TO app_user;

-- audit_log_entries is true append-only (CLAUDE.md §5): SELECT, INSERT only, never UPDATE.
GRANT SELECT, INSERT ON audit_log_entries TO app_user;

-- platform_operator: read-only across the board (support tooling), gated by audited access
-- at the application layer in Phase 5 — this just grants the base privilege.
GRANT SELECT ON
  organizations,
  workspaces,
  memberships,
  roles,
  role_permissions,
  membership_roles,
  service_accounts,
  api_keys,
  invitations,
  audit_log_entries,
  domain_events,
  principals,
  users,
  identities,
  sessions,
  permissions
TO platform_operator;
