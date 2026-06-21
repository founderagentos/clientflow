import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import { invitations } from './invitations.schema';

export interface InvitationRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  email: string;
  roleId: string;
  status: string;
  expiresAt: Date;
}

/**
 * Reads/writes `invitations` within the active organization (RLS-scoped). The pre-auth lookup an
 * invitee needs to accept before any tenant context exists lives in
 * {@link InvitationLookupRepository}, not here.
 */
@Injectable()
export class InvitationsRepository {
  async insert(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      workspaceId: string;
      email: string;
      roleId: string;
      tokenHash: string;
      expiresAt: Date;
      invitedBy: string;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    await tx.insert(invitations).values({
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      email: input.email,
      roleId: input.roleId,
      tokenHash: input.tokenHash,
      status: 'pending',
      expiresAt: input.expiresAt,
      invitedBy: input.invitedBy,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
  }

  async findById(tx: Tx, id: string): Promise<InvitationRow | null> {
    const [row] = await tx
      .select({
        id: invitations.id,
        organizationId: invitations.organizationId,
        workspaceId: invitations.workspaceId,
        email: invitations.email,
        roleId: invitations.roleId,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(and(eq(invitations.id, id), isNull(invitations.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async listByWorkspace(tx: Tx, workspaceId: string): Promise<InvitationRow[]> {
    return tx
      .select({
        id: invitations.id,
        organizationId: invitations.organizationId,
        workspaceId: invitations.workspaceId,
        email: invitations.email,
        roleId: invitations.roleId,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(and(eq(invitations.workspaceId, workspaceId), isNull(invitations.deletedAt)))
      .orderBy(invitations.createdAt);
  }

  async markAccepted(tx: Tx, id: string, actorPrincipalId: string): Promise<void> {
    await tx
      .update(invitations)
      .set({ status: 'accepted', updatedAt: new Date(), updatedBy: actorPrincipalId })
      .where(and(eq(invitations.id, id), isNull(invitations.deletedAt)));
  }

  async markRevoked(tx: Tx, id: string, actorPrincipalId: string): Promise<void> {
    await tx
      .update(invitations)
      .set({
        ...softDeletePatch(actorPrincipalId),
        status: 'revoked',
      })
      .where(and(eq(invitations.id, id), isNull(invitations.deletedAt)));
  }
}
