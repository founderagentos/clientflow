import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { newId } from '@agentos/identifier';
import { TenancyAggregateType, TenancyEventType } from '@agentos/contracts';
import { InvitationsRepository, type InvitationRow } from '../infrastructure/invitations.repository';
import { WorkspacesRepository } from '../infrastructure/workspaces.repository';
import { mintInvitationToken, hashInvitationToken } from '../domain/invitation-token';

/** Acting principal + active tenant context, resolved by the host from the access token. */
export interface InvitationActor {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  correlationId: string;
}

export interface CreateInvitationInput {
  workspaceId: string;
  email: string;
  roleId: string;
}

export interface CreatedInvitation {
  invitationId: string;
  /** Plaintext token — returned to the inviter exactly once for the link; only its hash is stored. */
  token: string;
  expiresAt: Date;
}

/** Pending invitations live this long before {@link decideInvitation} treats them as expired. */
const INVITATION_TTL_DAYS = 7;
const FK_VIOLATION = '23503';

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === FK_VIOLATION;
}

/**
 * Invitation issuance/revocation within the active organization (CLAUDE.md §6 Phase 3 — invite →
 * accept → membership). Acceptance is a host orchestrator (it spans identity + access), since a
 * new invitee has no account or tenant context yet. Each operation runs in a tenant transaction
 * and emits its PastTense event in the same unit of work (§3.14).
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly workspaces: WorkspacesRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async invite(actor: InvitationActor, input: CreateInvitationInput): Promise<CreatedInvitation> {
    const invitationId = newId();
    const token = mintInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const email = input.email.trim().toLowerCase();

    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const workspace = await this.workspaces.findById(tx, input.workspaceId);
      if (!workspace) {
        throw new NotFoundError('Workspace not found');
      }
      try {
        await this.invitations.insert(tx, {
          id: invitationId,
          organizationId: actor.organizationId,
          workspaceId: input.workspaceId,
          email,
          roleId: input.roleId,
          tokenHash: hashInvitationToken(token),
          expiresAt,
          invitedBy: actor.principalId,
          actorPrincipalId: actor.principalId,
        });
      } catch (error) {
        // role_id FK — the role does not exist; never confirm which id failed (§3.8).
        if (isForeignKeyViolation(error)) {
          throw new NotFoundError('Role not found');
        }
        throw error;
      }
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: input.workspaceId,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: TenancyAggregateType.Invitation,
        aggregateId: invitationId,
        type: TenancyEventType.MemberInvited,
        payload: { invitationId, workspaceId: input.workspaceId, email, roleId: input.roleId },
      });
      return { invitationId, token, expiresAt };
    });
  }

  async list(actor: InvitationActor, workspaceId: string): Promise<InvitationRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.invitations.listByWorkspace(tx, workspaceId),
    );
  }

  async revoke(actor: InvitationActor, invitationId: string): Promise<void> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const invitation = await this.invitations.findById(tx, invitationId);
      if (!invitation) {
        throw new NotFoundError('Invitation not found');
      }
      await this.invitations.markRevoked(tx, invitationId, actor.principalId);
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: invitation.workspaceId,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: TenancyAggregateType.Invitation,
        aggregateId: invitationId,
        type: TenancyEventType.InvitationRevoked,
        payload: { invitationId },
      });
    });
  }

  private scope(actor: InvitationActor): { organizationId: string; workspaceId: string | null } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
