import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '@agentos/persistence-kernel';
import { permissions } from './permissions.schema';

export interface PermissionRow {
  id: string;
  key: string;
  resource: string;
  action: string;
  description: string | null;
}

/**
 * Read-only access to the global permission catalog (CLAUDE.md §3.10). The catalog is
 * platform-wide (not tenant-owned); it is the contract between modules and the PDP.
 */
@Injectable()
export class PermissionsRepository {
  private columns = {
    id: permissions.id,
    key: permissions.key,
    resource: permissions.resource,
    action: permissions.action,
    description: permissions.description,
  };

  async listAll(tx: Tx): Promise<PermissionRow[]> {
    return tx
      .select(this.columns)
      .from(permissions)
      .where(isNull(permissions.deletedAt))
      .orderBy(permissions.key);
  }

  async findByKey(tx: Tx, key: string): Promise<PermissionRow | null> {
    const [row] = await tx
      .select(this.columns)
      .from(permissions)
      .where(and(eq(permissions.key, key), isNull(permissions.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findByKeys(tx: Tx, keys: string[]): Promise<PermissionRow[]> {
    if (keys.length === 0) {
      return [];
    }
    return tx
      .select(this.columns)
      .from(permissions)
      .where(and(inArray(permissions.key, keys), isNull(permissions.deletedAt)));
  }
}
