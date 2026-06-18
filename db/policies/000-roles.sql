-- The two non-superuser roles RLS depends on (CLAUDE.md §6 Phase 1, §3.9). Idempotent: safe
-- to re-run against an already-provisioned database.
--
-- (citext is created in db/migrations/0000 instead of here — it must exist before migrations
-- run, since several columns use the type, but policies are applied after migrations.)
--
-- Passwords are NOT set here. A literal password in a file committed to git would violate
-- CLAUDE.md §2/§3.20 ("never in code, env files committed to git, logs, or prompts").
-- apply-policies.ts sets each role's password afterwards via a parameterized ALTER ROLE from
-- an environment variable.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOSUPERUSER NOINHERIT LOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_operator') THEN
    -- BYPASSRLS is the literal mechanism for the constitution's "platform_operator bypasses
    -- RLS for support tooling" (CLAUDE.md §3 — "platform_operator for support — audited").
    -- Auditing this role's access is Phase 5 scope (consumes the event backbone), not Phase 1.
    CREATE ROLE platform_operator NOSUPERUSER NOINHERIT LOGIN BYPASSRLS;
  END IF;
END
$$;
