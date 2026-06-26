import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Nx's `test` target runs vitest with cwd = this project's root (apps/api/project.json),
// so this is reliably the repo root regardless of how the test is invoked.
const repoRoot = join(process.cwd(), '../..');

/**
 * Proves CLAUDE.md §7 gate 1: with one organization's context set, no query — not even a
 * bare `SELECT *` with no `WHERE` — can return another organization's rows. RLS denies it at
 * the database, independent of whatever the application layer does or forgets to do.
 *
 * Runs against a real, throwaway Postgres (Testcontainers), not a mock — this is the one
 * property in the whole kernel that must never be faked.
 */
describe('tenant isolation (RLS)', () => {
  let container: StartedPostgreSqlContainer;
  let adminSql: Sql;
  let appUserSql: Sql;
  let platformOperatorSql: Sql;
  let nonSuperuserOwnerSql: Sql;

  const orgA = '00000000-0000-7000-8000-00000000000a';
  const orgB = '00000000-0000-7000-8000-00000000000b';
  const workspaceA = '00000000-0000-7000-8000-0000000000aa';
  const workspaceB = '00000000-0000-7000-8000-0000000000bb';
  // A second workspace inside Org A — proves CRM workspace isolation *within one organization*
  // (RFC-002 §6 / gate §13.1), which kernel tables (org-only RLS) cannot exercise.
  const workspaceA2 = '00000000-0000-7000-8000-0000000000ac';
  const leadA = '00000000-0000-7000-8000-00000000001a';
  const leadA2 = '00000000-0000-7000-8000-00000000001c';
  const leadB = '00000000-0000-7000-8000-00000000001b';
  const tagOrgScoped = '00000000-0000-7000-8000-00000000002a';
  const roleA = '00000000-0000-7000-8000-0000000000ca';
  const roleB = '00000000-0000-7000-8000-0000000000cb';
  const membershipA = '00000000-0000-7000-8000-0000000000da';
  const membershipB = '00000000-0000-7000-8000-0000000000db';
  const principalA = '00000000-0000-7000-8000-0000000000ea';
  const principalB = '00000000-0000-7000-8000-0000000000eb';
  const invitationA = '00000000-0000-7000-8000-0000000000fa';
  const invitationB = '00000000-0000-7000-8000-0000000000fb';
  const tokenHashA = 'a'.repeat(64);
  const tokenHashB = 'b'.repeat(64);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18').start();
    adminSql = postgres(container.getConnectionUri(), { max: 1 });

    await migrate(drizzle(adminSql), {
      migrationsFolder: join(repoRoot, 'db/migrations'),
    });

    // Shells out to the real `db:apply-policies` CLI entrypoint (db/policies/apply-policies.ts)
    // rather than importing it, so this test exercises the exact same code path a real deploy
    // uses — and so it doesn't pull a script outside apps/api's TS program (and its commonjs
    // module/rootDir settings) into this project's typecheck.
    await execFileAsync(join(repoRoot, 'node_modules/.bin/tsx'), [join(repoRoot, 'db/policies/apply-policies.ts')], {
      env: {
        ...process.env,
        DATABASE_URL: container.getConnectionUri(),
        APP_USER_DB_PASSWORD: 'app_user_pw',
        PLATFORM_OPERATOR_DB_PASSWORD: 'platform_operator_pw',
      },
    });

    // A non-superuser, non-BYPASSRLS owner — the container's bootstrap role (like the local
    // docker-compose `agentos` role) is a genuine Postgres superuser, which always bypasses
    // RLS regardless of FORCE. Proving FORCE actually does something requires a table owner
    // that isn't a superuser; superuser bypass would otherwise mask a missing FORCE entirely.
    await adminSql.unsafe(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'non_superuser_owner') THEN CREATE ROLE non_superuser_owner NOSUPERUSER NOINHERIT LOGIN; END IF; END $$;",
    );
    await adminSql.unsafe("ALTER ROLE non_superuser_owner WITH PASSWORD $pwd$owner_pw$pwd$");
    await adminSql.unsafe('ALTER TABLE workspaces OWNER TO non_superuser_owner');
    // Also re-own a CRM table, to prove FORCE RLS holds on the CRM org+workspace policy too.
    await adminSql.unsafe('ALTER TABLE leads OWNER TO non_superuser_owner');

    await adminSql.unsafe(`
      INSERT INTO principals (id, type) VALUES
        ('${principalA}', 'user'),
        ('${principalB}', 'user');
      INSERT INTO organizations (id, slug, name) VALUES
        ('${orgA}', 'org-a', 'Org A'),
        ('${orgB}', 'org-b', 'Org B');
      INSERT INTO workspaces (id, organization_id, slug, name) VALUES
        ('${workspaceA}', '${orgA}', 'ws-a', 'WS A'),
        ('${workspaceA2}', '${orgA}', 'ws-a2', 'WS A2'),
        ('${workspaceB}', '${orgB}', 'ws-b', 'WS B');
      INSERT INTO roles (id, organization_id, scope, name) VALUES
        ('${roleA}', '${orgA}', 'workspace', 'custom-a'),
        ('${roleB}', '${orgB}', 'workspace', 'custom-b');
      INSERT INTO memberships (id, organization_id, workspace_id, principal_id, status) VALUES
        ('${membershipA}', '${orgA}', '${workspaceA}', '${principalA}', 'active'),
        ('${membershipB}', '${orgB}', '${workspaceB}', '${principalB}', 'active');
      INSERT INTO membership_roles (membership_id, role_id) VALUES
        ('${membershipA}', '${roleA}'),
        ('${membershipB}', '${roleB}');
      INSERT INTO invitations (id, organization_id, workspace_id, email, role_id, token_hash, expires_at) VALUES
        ('${invitationA}', '${orgA}', '${workspaceA}', 'a@example.com', '${roleA}', '${tokenHashA}', now() + interval '7 days'),
        ('${invitationB}', '${orgB}', '${workspaceB}', 'b@example.com', '${roleB}', '${tokenHashB}', now() + interval '7 days');
      -- CRM rows: two leads in different workspaces of the SAME org (A vs A2), one in Org B, and an
      -- org-scoped (workspace_id NULL) tag — to exercise workspace isolation + the org-scoped escape.
      INSERT INTO leads (id, organization_id, workspace_id, status, name) VALUES
        ('${leadA}', '${orgA}', '${workspaceA}', 'new', 'Lead A'),
        ('${leadA2}', '${orgA}', '${workspaceA2}', 'new', 'Lead A2'),
        ('${leadB}', '${orgB}', '${workspaceB}', 'new', 'Lead B');
      INSERT INTO tags (id, organization_id, workspace_id, name) VALUES
        ('${tagOrgScoped}', '${orgA}', NULL, 'org-wide');
    `);

    const connectionUrl = new URL(container.getConnectionUri());
    const urlFor = (username: string, password: string) => {
      const url = new URL(connectionUrl.toString());
      url.username = username;
      url.password = password;
      return url.toString();
    };

    appUserSql = postgres(urlFor('app_user', 'app_user_pw'), { max: 1 });
    platformOperatorSql = postgres(urlFor('platform_operator', 'platform_operator_pw'), { max: 1 });
    nonSuperuserOwnerSql = postgres(urlFor('non_superuser_owner', 'owner_pw'), { max: 1 });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([
      adminSql?.end({ timeout: 5 }),
      appUserSql?.end({ timeout: 5 }),
      platformOperatorSql?.end({ timeout: 5 }),
      nonSuperuserOwnerSql?.end({ timeout: 5 }),
    ]);
    await container?.stop();
  });

  it('returns only Org A rows when Org A context is set, with no WHERE clause at all', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    const rows = await appUserSql`SELECT id FROM workspaces`;
    // Org A owns two workspaces (A + A2); neither Org B workspace is visible.
    expect(rows.map((row) => row.id).sort()).toEqual([workspaceA, workspaceA2].sort());
  });

  it('returns only Org B rows when Org B context is set', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgB}', false)`);
    const rows = await appUserSql`SELECT id FROM workspaces`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(workspaceB);
  });

  it('fails closed (errors, returns no rows) when no tenant context is set', async () => {
    const freshConnection = postgres(
      new URL(
        (() => {
          const url = new URL(container.getConnectionUri());
          url.username = 'app_user';
          url.password = 'app_user_pw';
          return url.toString();
        })(),
      ).toString(),
      { max: 1 },
    );
    await expect(freshConnection`SELECT id FROM workspaces`).rejects.toThrow(
      /unrecognized configuration parameter/,
    );
    await freshConnection.end({ timeout: 5 });
  });

  it('still restricts a non-superuser table owner — proves FORCE ROW LEVEL SECURITY, not just ENABLE', async () => {
    await nonSuperuserOwnerSql.unsafe(
      `SELECT set_config('app.current_organization_id', '${orgA}', false)`,
    );
    const rows = await nonSuperuserOwnerSql`SELECT id FROM workspaces`;
    expect(rows.map((row) => row.id).sort()).toEqual([workspaceA, workspaceA2].sort());
  });

  it('platform_operator (BYPASSRLS) sees rows across every organization', async () => {
    const rows = await platformOperatorSql`SELECT id FROM workspaces`;
    expect(rows.map((row) => row.id).sort()).toEqual(
      [workspaceA, workspaceA2, workspaceB].sort(),
    );
  });

  it('isolates a junction table (membership_roles) via its EXISTS-subquery policy', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    const rows = await appUserSql`SELECT membership_id, role_id FROM membership_roles`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role_id).toBe(roleA);
  });

  it('isolates invitations to the active organization', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    const rows = await appUserSql`SELECT id FROM invitations`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(invitationA);
  });

  it('accept-time lookup resolves an invitation by token hash without widening tenant visibility', async () => {
    // Org A's context is set, yet the SECURITY DEFINER function still resolves Org B's invitation
    // — but ONLY because the caller presents B's exact 256-bit token hash. Direct selects remain
    // org-scoped (previous test). This is the same narrow, audited escape hatch as auth-time
    // membership resolution (CLAUDE.md §7 gate 1 preserved — possession of the token is the key).
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    const found = await appUserSql`SELECT id, organization_id FROM auth_invitation_by_token_hash(${tokenHashB})`;
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(invitationB);
    expect(found[0]?.organization_id).toBe(orgB);

    const missing = await appUserSql`SELECT id FROM auth_invitation_by_token_hash(${'c'.repeat(64)})`;
    expect(missing).toHaveLength(0);
  });

  // ── CRM Core (RFC-002 §6 / gate §13.1): RLS enforces org AND active-workspace. ──────────────

  it('CRM: returns only the active workspace rows, with no WHERE clause (workspace isolation)', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    await appUserSql.unsafe(`SELECT set_config('app.current_workspace_id', '${workspaceA}', false)`);
    const rows = await appUserSql`SELECT id FROM leads`;
    expect(rows.map((row) => row.id)).toEqual([leadA]);
  });

  it('CRM: a sibling workspace in the SAME org cannot read this workspace rows', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    await appUserSql.unsafe(`SELECT set_config('app.current_workspace_id', '${workspaceA2}', false)`);
    const rows = await appUserSql`SELECT id FROM leads`;
    expect(rows.map((row) => row.id)).toEqual([leadA2]);
  });

  it('CRM: cross-org rows stay invisible even with a workspace active', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    await appUserSql.unsafe(`SELECT set_config('app.current_workspace_id', '${workspaceA}', false)`);
    const rows = await appUserSql`SELECT id FROM leads WHERE id = ${leadB}`;
    expect(rows).toHaveLength(0);
  });

  it('CRM: org-scoped config (workspace_id NULL) is visible under any active workspace', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    await appUserSql.unsafe(`SELECT set_config('app.current_workspace_id', '${workspaceA}', false)`);
    const rows = await appUserSql`SELECT id FROM tags`;
    expect(rows.map((row) => row.id)).toEqual([tagOrgScoped]);
  });

  it('CRM: workspace-scoped rows are hidden when only an org context is set (empty-GUC hardening)', async () => {
    // No workspace active: app.current_workspace_id is unset/'' → NULLIF makes it NULL → leads hidden.
    const conn = postgres(
      (() => {
        const url = new URL(container.getConnectionUri());
        url.username = 'app_user';
        url.password = 'app_user_pw';
        return url.toString();
      })(),
      { max: 1 },
    );
    await conn.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    const rows = await conn`SELECT id FROM leads`;
    expect(rows).toHaveLength(0);
    await conn.end({ timeout: 5 });
  });

  it('CRM: still restricts a non-superuser owner of leads — proves FORCE RLS on a CRM table', async () => {
    await nonSuperuserOwnerSql.unsafe(
      `SELECT set_config('app.current_organization_id', '${orgA}', false)`,
    );
    await nonSuperuserOwnerSql.unsafe(
      `SELECT set_config('app.current_workspace_id', '${workspaceA}', false)`,
    );
    const rows = await nonSuperuserOwnerSql`SELECT id FROM leads`;
    expect(rows.map((row) => row.id)).toEqual([leadA]);
  });
});
