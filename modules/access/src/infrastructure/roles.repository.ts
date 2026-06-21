import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '@agentos/result-errors';
import {
  assertVersionMatched,
  nextVersion,
  softDeletePatch,
  type Tx,
} from '@agentos/persistence-kernel';
import { roles } from './roles.schema';

export interface RoleRow {
  id: string;
  organizationId: string | null;
  scope: string;
  name: string;
  isSystem: boolean;
  version: number;
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION
  );
}

/**
 * Reads/writes roles within the active organization. System roles (`organization_id IS NULL`,
 * `is_system = true`) are visible to every tenant via the `roles` RLS policy but are immutable —
 * mutation attempts are rejected (422) before touching the row. Custom roles are tenant-owned
 * and follow the standard optimistic-lock + soft-delete contract (CLAUDE.md §3.4).
 */
@Injectable()
export class RolesRepository {
  private columns = {
    id: roles.id,
    organizationId: roles.organizationId,
    scope: roles.scope,
    name: roles.name,
    isSystem: roles.isSystem,
    version: roles.version,
  };

  async findById(tx: Tx, id: string): Promise<RoleRow | null> {
    const [row] = await tx
      .select(this.columns)
      .from(roles)
      .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** All roles visible to the active tenant — its own custom roles plus the system templates. */
  async listVisible(tx: Tx): Promise<RoleRow[]> {
    return tx
      .select(this.columns)
      .from(roles)
      .where(isNull(roles.deletedAt))
      .orderBy(roles.name);
  }

  async insert(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      scope: 'organization' | 'workspace';
      name: string;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    try {
      await tx.insert(roles).values({
        id: input.id,
        organizationId: input.organizationId,
        scope: input.scope,
        name: input.name,
        isSystem: false,
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A role with this name and scope already exists');
      }
      throw error;
    }
  }

  /** Optimistic-locked rename of a custom role. Returns the changed field names. */
  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: { name?: string | undefined };
    },
  ): Promise<string[]> {
    await this.assertMutableCustomRole(tx, input.id);
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as 'name'] !== undefined,
    );
    try {
      const rows = await tx
        .update(roles)
        .set({
          ...input.fields,
          version: nextVersion(input.expectedVersion),
          updatedAt: new Date(),
          updatedBy: input.actorPrincipalId,
        })
        .where(
          and(eq(roles.id, input.id), eq(roles.version, input.expectedVersion), isNull(roles.deletedAt)),
        )
        .returning({ id: roles.id });
      assertVersionMatched(rows.length);
      return changed;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A role with this name and scope already exists');
      }
      throw error;
    }
  }

  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    await this.assertMutableCustomRole(tx, input.id);
    const rows = await tx
      .update(roles)
      .set({ ...softDeletePatch(input.actorPrincipalId), version: nextVersion(input.expectedVersion) })
      .where(
        and(eq(roles.id, input.id), eq(roles.version, input.expectedVersion), isNull(roles.deletedAt)),
      )
      .returning({ id: roles.id });
    assertVersionMatched(rows.length);
  }

  private async assertMutableCustomRole(tx: Tx, id: string): Promise<void> {
    const role = await this.findById(tx, id);
    if (!role) {
      // Absent, or hidden by RLS (cross-tenant) — never confirm which (§3.8).
      throw new NotFoundError('Role not found');
    }
    if (role.isSystem) {
      throw new ValidationError('System roles cannot be modified', {
        role: ['system roles are immutable'],
      });
    }
  }
}
