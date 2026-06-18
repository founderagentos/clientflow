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
  const roleA = '00000000-0000-7000-8000-0000000000ca';
  const roleB = '00000000-0000-7000-8000-0000000000cb';
  const membershipA = '00000000-0000-7000-8000-0000000000da';
  const membershipB = '00000000-0000-7000-8000-0000000000db';
  const principalA = '00000000-0000-7000-8000-0000000000ea';
  const principalB = '00000000-0000-7000-8000-0000000000eb';

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

    await adminSql.unsafe(`
      INSERT INTO principals (id, type) VALUES
        ('${principalA}', 'user'),
        ('${principalB}', 'user');
      INSERT INTO organizations (id, slug, name) VALUES
        ('${orgA}', 'org-a', 'Org A'),
        ('${orgB}', 'org-b', 'Org B');
      INSERT INTO workspaces (id, organization_id, slug, name) VALUES
        ('${workspaceA}', '${orgA}', 'ws-a', 'WS A'),
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
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(workspaceA);
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
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(workspaceA);
  });

  it('platform_operator (BYPASSRLS) sees rows across every organization', async () => {
    const rows = await platformOperatorSql`SELECT id FROM workspaces`;
    expect(rows.map((row) => row.id).sort()).toEqual([workspaceA, workspaceB].sort());
  });

  it('isolates a junction table (membership_roles) via its EXISTS-subquery policy', async () => {
    await appUserSql.unsafe(`SELECT set_config('app.current_organization_id', '${orgA}', false)`);
    const rows = await appUserSql`SELECT membership_id, role_id FROM membership_roles`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role_id).toBe(roleA);
  });
});
