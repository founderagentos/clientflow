import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ConflictError } from '@agentos/result-errors';
import { assertVersionMatched, nextVersion, softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import { workspaces } from './workspaces.schema';

export interface WorkspaceRow {
  id: string;
  organizationId: string;
  parentWorkspaceId: string | null;
  slug: string;
  name: string;
  status: string;
  version: number;
}

/** Postgres unique-violation SQLSTATE — a duplicate slug within the org's active rows. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION;
}

/**
 * Reads/writes workspaces within the active organization. Every method runs inside a tenant
 * transaction (workspaces RLS = `organization_id = app.current_organization_id`). Depth and
 * subtree walks use recursive CTEs that stay inside the same RLS scope, so they can never
 * traverse into another tenant's tree.
 */
@Injectable()
export class WorkspacesRepository {
  async findById(tx: Tx, id: string): Promise<WorkspaceRow | null> {
    const [row] = await tx
      .select({
        id: workspaces.id,
        organizationId: workspaces.organizationId,
        parentWorkspaceId: workspaces.parentWorkspaceId,
        slug: workspaces.slug,
        name: workspaces.name,
        status: workspaces.status,
        version: workspaces.version,
      })
      .from(workspaces)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async listByOrganization(tx: Tx): Promise<WorkspaceRow[]> {
    return tx
      .select({
        id: workspaces.id,
        organizationId: workspaces.organizationId,
        parentWorkspaceId: workspaces.parentWorkspaceId,
        slug: workspaces.slug,
        name: workspaces.name,
        status: workspaces.status,
        version: workspaces.version,
      })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt))
      .orderBy(workspaces.createdAt);
  }

  /**
   * Depth of an existing workspace, 1-based (a root is 1). Walks `parent_workspace_id` upward via
   * a recursive CTE. Returns 0 when the id is absent (caller treats "no parent" as depth 0).
   */
  async computeDepth(tx: Tx, workspaceId: string): Promise<number> {
    const rows = (await tx.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_workspace_id, 1 AS depth
          FROM workspaces WHERE id = ${workspaceId} AND deleted_at IS NULL
        UNION ALL
        SELECT w.id, w.parent_workspace_id, a.depth + 1
          FROM workspaces w JOIN ancestors a ON w.id = a.parent_workspace_id
          WHERE w.deleted_at IS NULL
      )
      SELECT COALESCE(MAX(depth), 0) AS depth FROM ancestors
    `)) as unknown as Array<{ depth: number | string }>;
    return Number(rows[0]?.depth ?? 0);
  }

  /** Ids of a workspace and all its (active) descendants — the archive cascade set. */
  async listSubtreeIds(tx: Tx, rootId: string): Promise<string[]> {
    const rows = (await tx.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM workspaces WHERE id = ${rootId} AND deleted_at IS NULL
        UNION ALL
        SELECT w.id FROM workspaces w JOIN subtree s ON w.parent_workspace_id = s.id
          WHERE w.deleted_at IS NULL
      )
      SELECT id FROM subtree
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  async insert(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      parentWorkspaceId: string | null;
      slug: string;
      name: string;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    try {
      await tx.insert(workspaces).values({
        id: input.id,
        organizationId: input.organizationId,
        parentWorkspaceId: input.parentWorkspaceId,
        slug: input.slug,
        name: input.name,
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A workspace with this slug already exists in the organization');
      }
      throw error;
    }
  }

  /** Optimistic-locked field update. Returns the changed field names. */
  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: { name?: string | undefined; slug?: string | undefined };
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as 'name' | 'slug'] !== undefined,
    );
    try {
      const rows = await tx
        .update(workspaces)
        .set({
          ...input.fields,
          version: nextVersion(input.expectedVersion),
          updatedAt: new Date(),
          updatedBy: input.actorPrincipalId,
        })
        .where(
          and(
            eq(workspaces.id, input.id),
            eq(workspaces.version, input.expectedVersion),
            isNull(workspaces.deletedAt),
          ),
        )
        .returning({ id: workspaces.id });
      assertVersionMatched(rows.length);
      return changed;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A workspace with this slug already exists in the organization');
      }
      throw error;
    }
  }

  /**
   * Archive (soft-delete) a single workspace, optimistic-locked on the root's version. Sets
   * `status='archived'` and `deleted_at` so it leaves active listings and frees its slug (§3.4).
   */
  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(workspaces)
      .set({
        ...softDeletePatch(input.actorPrincipalId),
        status: 'archived',
        version: nextVersion(input.expectedVersion),
      })
      .where(
        and(
          eq(workspaces.id, input.id),
          eq(workspaces.version, input.expectedVersion),
          isNull(workspaces.deletedAt),
        ),
      )
      .returning({ id: workspaces.id });
    assertVersionMatched(rows.length);
  }

  /** Archive descendants in the cascade (no version check — they follow the parent). */
  async archiveCascade(tx: Tx, ids: string[], actorPrincipalId: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      await tx
        .update(workspaces)
        .set({ ...softDeletePatch(actorPrincipalId), status: 'archived' })
        .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)));
    }
  }
}
