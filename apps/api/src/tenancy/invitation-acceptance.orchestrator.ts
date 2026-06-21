import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '@agentos/result-errors';
import { newId } from '@agentos/identifier';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { IdentityAggregateType, IdentityEventType, TenancyAggregateType, TenancyEventType } from '@agentos/contracts';
import {
  PasswordHasher,
  UserRegistrar,
  SessionIssuer,
  type ClientMeta,
  type IssuedTokens,
} from '@agentos/identity';
import {
  InvitationLookupRepository,
  InvitationAcceptanceWriter,
  MembershipWriter,
  decideInvitation,
  hashInvitationToken,
} from '@agentos/workspace';
import { RoleAssigner } from '@agentos/access';

export interface AcceptInvitationInput {
  token: string;
  /** Set when the request carried a valid bearer token (existing-user acceptance). */
  authenticatedPrincipalId?: string | null;
  /** Required for signup-via-invite (no bearer); ignored for existing-user acceptance. */
  password?: string | undefined;
  displayName?: string | undefined;
  correlationId: string;
  client?: ClientMeta | undefined;
}

export interface AcceptInvitationResult {
  membershipId: string;
  principalId: string;
  newUser: boolean;
  /** Present only for signup-via-invite — the new account is auto-logged-in. */
  tokens?: IssuedTokens | undefined;
}

/**
 * Cross-context invitation acceptance (CLAUDE.md §3.1/§17, gate §6 — invite → accept →
 * membership). Lives at the host — the only layer permitted to compose multiple bounded contexts
 * — and weaves identity (new-user signup) + workspace (membership) + access (role) into ONE
 * atomic transaction, plus every domain event to the outbox in the same unit of work (§3.14).
 *
 * The invitation is resolved by token hash via a SECURITY DEFINER pre-auth read (the invitee may
 * have no account or tenant context yet); the returned org/workspace then key the RLS
 * transaction. Possession of the unguessable token is the authorization to accept.
 */
@Injectable()
export class InvitationAcceptanceOrchestrator {
  constructor(
    private readonly lookup: InvitationLookupRepository,
    private readonly acceptance: InvitationAcceptanceWriter,
    private readonly memberships: MembershipWriter,
    private readonly roles: RoleAssigner,
    private readonly hasher: PasswordHasher,
    private readonly userRegistrar: UserRegistrar,
    private readonly sessionIssuer: SessionIssuer,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async accept(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
    const tokenHash = hashInvitationToken(input.token);
    const invitation = await this.lookup.findByTokenHash(tokenHash);
    if (!invitation) {
      // Never confirm whether the token existed (§3.8).
      throw new NotFoundError('Invitation not found');
    }

    // Pure status/expiry decision. `invalid` (non-pending) collapses to 404 for the same reason.
    const decision = decideInvitation(
      { status: invitation.status as 'pending', expiresAt: invitation.expiresAt },
      new Date(),
    );
    if (decision.kind === 'invalid') {
      throw new NotFoundError('Invitation not found');
    }
    if (decision.kind === 'expired') {
      throw new ConflictError('Invitation has expired');
    }

    const newUser = !input.authenticatedPrincipalId;
    if (newUser && (!input.password || !input.displayName)) {
      throw new ValidationError('Signup-via-invite requires password and displayName', {
        password: input.password ? [] : ['Required'],
        displayName: input.displayName ? [] : ['Required'],
      });
    }
    // Hash before the transaction so the slow Argon2 KDF never holds the open connection.
    const passwordHash = newUser ? await this.hasher.hash(input.password as string) : null;
    const principalId = input.authenticatedPrincipalId ?? newId();
    const membershipId = newId();

    return withTenantTransaction(
      this.db,
      { organizationId: invitation.organizationId, workspaceId: invitation.workspaceId },
      async (tx) => {
        // Re-read under RLS to close the gap between the pre-auth lookup and this tx.
        const pending = await this.acceptance.loadInvitation(tx, invitation.id);
        if (!pending || pending.status !== 'pending') {
          throw new ConflictError('Invitation is no longer pending');
        }

        if (newUser) {
          await this.userRegistrar.create(tx, {
            principalId,
            email: invitation.email,
            displayName: input.displayName as string,
            passwordHash: passwordHash as string,
          });
        } else {
          const existing = await this.acceptance.findExistingMembership(
            tx,
            principalId,
            invitation.workspaceId,
          );
          if (existing) {
            throw new ConflictError('Already a member of this workspace');
          }
        }

        await this.memberships.grantMembership(tx, {
          membershipId,
          organizationId: invitation.organizationId,
          workspaceId: invitation.workspaceId,
          principalId,
          status: 'active',
          invitedBy: null,
          actorPrincipalId: principalId,
        });
        const role = await this.roles.assignRole(tx, { membershipId, roleId: invitation.roleId });
        await this.acceptance.markAccepted(tx, invitation.id, principalId);

        let tokens: IssuedTokens | undefined;
        if (newUser) {
          tokens = await this.sessionIssuer.issue(tx, {
            principalId,
            tokenVersion: 0,
            organizationId: invitation.organizationId,
            workspaceId: invitation.workspaceId,
            client: input.client,
          });
        }

        const base = {
          organizationId: invitation.organizationId,
          workspaceId: invitation.workspaceId,
          actorPrincipalId: principalId,
          correlationId: input.correlationId,
          causationId: null,
        };
        if (newUser) {
          await this.outbox.append(tx, {
            ...base,
            aggregateType: IdentityAggregateType.User,
            aggregateId: principalId,
            type: IdentityEventType.UserRegistered,
            payload: { userId: principalId, email: invitation.email, displayName: input.displayName },
          });
        }
        await this.outbox.append(tx, {
          ...base,
          aggregateType: TenancyAggregateType.Invitation,
          aggregateId: invitation.id,
          type: TenancyEventType.InvitationAccepted,
          payload: { invitationId: invitation.id, membershipId, principalId, newUser },
        });
        await this.outbox.append(tx, {
          ...base,
          aggregateType: TenancyAggregateType.Membership,
          aggregateId: membershipId,
          type: TenancyEventType.MembershipCreated,
          payload: { membershipId, principalId, workspaceId: invitation.workspaceId, roleId: role.roleId },
        });
        await this.outbox.append(tx, {
          ...base,
          aggregateType: TenancyAggregateType.Membership,
          aggregateId: membershipId,
          type: IdentityEventType.RoleAssigned,
          payload: { membershipId, roleId: role.roleId, roleName: role.roleName },
        });
        if (newUser && tokens) {
          await this.outbox.append(tx, {
            ...base,
            aggregateType: IdentityAggregateType.Session,
            aggregateId: tokens.sessionId,
            type: IdentityEventType.SessionCreated,
            payload: { sessionId: tokens.sessionId, familyId: tokens.familyId },
          });
        }

        return { membershipId, principalId, newUser, tokens };
      },
    );
  }
}
