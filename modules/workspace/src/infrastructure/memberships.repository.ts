import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import { memberships } from './memberships.schema';

export interface MembershipRow {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  principalId: string;
  status: string;
}

/**
 * Reads/writes the `memberships` rows of the active organization. RLS scopes every query to the
 * org (`organization_id = app.current_organization_id`); the service layer opens the tenant
 * transaction. Role assignment lives in the access module (it owns `membership_roles`).
 */
@Injectable()
export class MembershipsRepository {
  /**
   * The membership-presence check behind the host guard (CLAUDE.md §6 — "membership grants
   * access, absence denies it"). True iff the principal has any active membership (org- or
   * workspace-level) in the current org context. Per-workspace permission granularity is the
   * Phase 4 PDP's job; Phase 3's interim rule is org-level presence. Defense-in-depth: a removed
   * member is denied here even if their access token has not yet expired.
   */
  async hasAnyActiveMembership(tx: Tx, principalId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.principalId, principalId),
          eq(memberships.status, 'active'),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async findById(tx: Tx, id: string): Promise<MembershipRow | null> {
    const [row] = await tx
      .select({
        id: memberships.id,
        organizationId: memberships.organizationId,
        workspaceId: memberships.workspaceId,
        principalId: memberships.principalId,
        status: memberships.status,
      })
      .from(memberships)
      .where(and(eq(memberships.id, id), isNull(memberships.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** Active memberships of a workspace, including org-level memberships that span it. */
  async listForWorkspace(tx: Tx, workspaceId: string): Promise<MembershipRow[]> {
    return tx
      .select({
        id: memberships.id,
        organizationId: memberships.organizationId,
        workspaceId: memberships.workspaceId,
        principalId: memberships.principalId,
        status: memberships.status,
      })
      .from(memberships)
      .where(
        and(
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
          isNull(memberships.deletedAt),
        ),
      )
      .orderBy(memberships.createdAt);
  }

  /** Find an active membership for a principal in a specific scope (used by invitation accept). */
  async findActiveInScope(
    tx: Tx,
    principalId: string,
    workspaceId: string | null,
  ): Promise<MembershipRow | null> {
    const scopeMatch =
      workspaceId === null
        ? isNull(memberships.workspaceId)
        : eq(memberships.workspaceId, workspaceId);
    const [row] = await tx
      .select({
        id: memberships.id,
        organizationId: memberships.organizationId,
        workspaceId: memberships.workspaceId,
        principalId: memberships.principalId,
        status: memberships.status,
      })
      .from(memberships)
      .where(
        and(eq(memberships.principalId, principalId), scopeMatch, isNull(memberships.deletedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  async softDelete(tx: Tx, id: string, actorPrincipalId: string): Promise<void> {
    await tx
      .update(memberships)
      .set({ ...softDeletePatch(actorPrincipalId), status: 'suspended', version: sql`version + 1` })
      .where(and(eq(memberships.id, id), isNull(memberships.deletedAt)));
  }
}
