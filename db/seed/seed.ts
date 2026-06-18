import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { permissions } from '../../modules/access/src/infrastructure/permissions.schema';
import { roles } from '../../modules/access/src/infrastructure/roles.schema';
import { rolePermissions } from '../../modules/access/src/infrastructure/role-permissions.schema';

/**
 * Kernel-only permission catalog (CLAUDE.md §3.10) — explicit `resource.action` strings, no
 * business-module permissions (those are illustrative-only in the RFC, out of scope here —
 * CLAUDE.md §9).
 */
const PERMISSION_KEYS = [
  'workspace.create',
  'workspace.read',
  'workspace.update',
  'workspace.delete',
  'member.invite',
  'member.read',
  'member.remove',
  'member.update',
  'role.create',
  'role.read',
  'role.update',
  'role.delete',
  'role.assign',
  'service_account.create',
  'service_account.read',
  'service_account.update',
  'service_account.delete',
  'api_key.create',
  'api_key.read',
  'api_key.revoke',
  'audit.read',
  'organization.read',
  'organization.update',
] as const;

const MEMBER_PERMISSION_KEYS = [
  'workspace.read',
  'member.read',
  'role.read',
  'service_account.read',
  'api_key.read',
  'audit.read',
] as const;

/** System roles (CLAUDE.md §3.3) — `organization_id = NULL`, `is_system = true`. */
const SYSTEM_ROLES = [
  { scope: 'organization' as const, name: 'Owner', permissionKeys: PERMISSION_KEYS },
  {
    scope: 'organization' as const,
    name: 'Admin',
    permissionKeys: PERMISSION_KEYS.filter(
      (key) => key !== 'organization.update' && key !== 'role.delete',
    ),
  },
  { scope: 'workspace' as const, name: 'Member', permissionKeys: MEMBER_PERMISSION_KEYS },
];

export async function seed(database: ReturnType<typeof drizzle>): Promise<void> {
  await database
    .insert(permissions)
    .values(
      PERMISSION_KEYS.map((key) => {
        const [resource, action] = key.split('.') as [string, string];
        return { key, resource, action };
      }),
    )
    .onConflictDoNothing({ target: permissions.key });

  const permissionRows = await database
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions);
  const permissionIdByKey = new Map(permissionRows.map((row) => [row.key, row.id]));

  for (const systemRole of SYSTEM_ROLES) {
    const [role] = await database
      .insert(roles)
      .values({ scope: systemRole.scope, name: systemRole.name, isSystem: true })
      .onConflictDoNothing({
        target: [roles.scope, roles.name],
        // Must match the partial index predicate exactly (roles_system_scope_name_key) for
        // Postgres to infer it as the conflict target.
        where: sql`organization_id is null and deleted_at is null`,
      })
      .returning();

    const roleRow =
      role ??
      (
        await database
          .select()
          .from(roles)
          .where(eq(roles.name, systemRole.name))
          .limit(1)
      )[0];

    if (!roleRow) {
      throw new Error(`Failed to seed or find system role: ${systemRole.name}`);
    }

    await database
      .insert(rolePermissions)
      .values(
        systemRole.permissionKeys.map((key) => {
          const permissionId = permissionIdByKey.get(key);
          if (!permissionId) {
            throw new Error(`Unknown permission key: ${key}`);
          }
          return { roleId: roleRow.id, permissionId };
        }),
      )
      .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permissionId] });
  }
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos';
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);
  try {
    await seed(database);
    console.log('Seed complete.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
