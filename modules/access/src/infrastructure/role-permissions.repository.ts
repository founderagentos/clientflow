import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@agentos/persistence-kernel';
import { rolePermissions } from './role-permissions.schema';
import { permissions } from './permissions.schema';

/**
 * Read/write the role↔permission map. Writes target only custom roles (the caller asserts the
 * role is mutable). Inserts are idempotent — re-granting a permission a role already holds is a
 * no-op. RLS confines visibility to the active tenant's roles via the `role_permissions` policy.
 */
@Injectable()
export class RolePermissionsRepository {
  async grant(tx: Tx, input: { roleId: string; permissionId: string }): Promise<void> {
    await tx
      .insert(rolePermissions)
      .values({ roleId: input.roleId, permissionId: input.permissionId })
      .onConflictDoNothing();
  }

  async revoke(tx: Tx, input: { roleId: string; permissionId: string }): Promise<void> {
    await tx
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, input.roleId),
          eq(rolePermissions.permissionId, input.permissionId),
        ),
      );
  }

  /** Permission keys currently granted to a role. */
  async listKeysByRole(tx: Tx, roleId: string): Promise<string[]> {
    const rows = await tx
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.key);
  }
}
