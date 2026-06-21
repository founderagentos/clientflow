import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';

/**
 * Postgres's ALTER ROLE grammar takes the password as a string literal, not a bind
 * parameter — `$1` placeholders are rejected with a syntax error. Dollar-quoting avoids
 * having to hand-escape quotes/backslashes; it only breaks if the password itself contains
 * the literal delimiter, which a generated/env-sourced password won't.
 */
function alterRolePassword(roleName: string, password: string): string {
  return `ALTER ROLE ${roleName} WITH PASSWORD $pwd$${password}$pwd$`;
}

/**
 * Applies db/policies/*.sql in lexical order, then sets the two role passwords. Passwords
 * never appear in the committed SQL files themselves (CLAUDE.md §2/§3.20) — they're applied
 * here from caller-supplied values (environment variables in the CLI entrypoint below). The
 * CLI entrypoint and the Testcontainers gate test both call this same function, so there is
 * exactly one source of truth for "what policies exist."
 */
export async function applyPolicies(
  sql: Sql,
  passwords: { appUser: string; platformOperator: string },
): Promise<void> {
  const files = [
    '000-roles.sql',
    '010-enable-and-force-rls.sql',
    '020-policies.sql',
    '030-grants.sql',
    '040-auth-functions.sql',
    '041-invitation-functions.sql',
    '042-api-key-functions.sql',
  ];

  for (const file of files) {
    const statements = readFileSync(join(import.meta.dirname, file), 'utf8');
    await sql.unsafe(statements);
  }

  await sql.unsafe(alterRolePassword('app_user', passwords.appUser));
  await sql.unsafe(alterRolePassword('platform_operator', passwords.platformOperator));
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos';
  const appUserPassword = process.env.APP_USER_DB_PASSWORD ?? 'app_user';
  const platformOperatorPassword = process.env.PLATFORM_OPERATOR_DB_PASSWORD ?? 'platform_operator';

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await applyPolicies(sql, { appUser: appUserPassword, platformOperator: platformOperatorPassword });
    console.log('Policies applied.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
