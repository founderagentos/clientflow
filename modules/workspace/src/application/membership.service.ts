import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { TenancyAggregateType, TenancyEventType } from '@agentos/contracts';
import { MembershipsRepository, type MembershipRow } from '../infrastructure/memberships.repository';

/** Acting principal + active tenant context, resolved by the host from the access token. */
export interface MembershipActor {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  correlationId: string;
}

/**
 * Membership reads and removal within the active organization (CLAUDE.md §6 Phase 3). The
 * membership-presence check ({@link hasActiveMembership}) backs the host's interim authorization
 * guard — the literal Phase 3 gate, "membership grants access, absence denies it"; the full
 * permission PDP arrives in Phase 4. Role assignment/removal lives in the access module (it owns
 * `membership_roles`); the host orchestrator composes the two for role changes.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly memberships: MembershipsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /** Backs the host membership guard. Runs in a tenant transaction (memberships are RLS-scoped). */
  async hasActiveMembership(actor: MembershipActor): Promise<boolean> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.memberships.hasAnyActiveMembership(tx, actor.principalId),
    );
  }

  async listMembers(actor: MembershipActor, workspaceId: string): Promise<MembershipRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.memberships.listForWorkspace(tx, workspaceId),
    );
  }

  /**
   * Soft-delete a membership and emit `MemberRemoved` (Phase 4's PDP cache invalidates on it).
   * The principal's `membership_roles` rows are left intact: they reference a now soft-deleted
   * membership and the PDP resolves permissions only through active memberships, so they are
   * inert. (Host role-management orchestrator handles explicit role cleanup when needed.)
   */
  async removeMember(actor: MembershipActor, membershipId: string): Promise<void> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const membership = await this.memberships.findById(tx, membershipId);
      if (!membership) {
        throw new NotFoundError('Membership not found');
      }
      await this.memberships.softDelete(tx, membershipId, actor.principalId);
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: membership.workspaceId,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: TenancyAggregateType.Membership,
        aggregateId: membershipId,
        type: TenancyEventType.MemberRemoved,
        payload: { membershipId, principalId: membership.principalId },
      });
    });
  }

  private scope(actor: MembershipActor): { organizationId: string; workspaceId: string | null } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
