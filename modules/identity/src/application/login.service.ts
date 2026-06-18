import { Inject, Injectable } from '@nestjs/common';
import { UnauthenticatedError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { IdentityAggregateType, IdentityEventType } from '@agentos/contracts';
import { IdentitiesRepository } from '../infrastructure/identities.repository';
import { PasswordHasher } from '../infrastructure/argon2-password-hasher';
import {
  AuthMembershipRepository,
  type ActiveMembership,
} from '../infrastructure/auth-membership.repository';
import { SessionIssuer, type ClientMeta, type IssuedTokens } from './session-issuer';

export interface LoginInput {
  email: string;
  password: string;
  correlationId: string;
  client?: ClientMeta;
}

/** Pick the active context: prefer the org-level membership (where Owner/Admin live), else the
 * earliest membership. Phase 2 users have exactly one; multi-org selection is Phase 3. */
function selectActiveMembership(memberships: ActiveMembership[]): ActiveMembership | null {
  return memberships.find((m) => m.workspaceId === null) ?? memberships[0] ?? null;
}

/**
 * Verifies password credentials and establishes a session (CLAUDE.md §3.11/§3.12).
 * Anti-enumeration: identical 401 for unknown-email and wrong-password, and a dummy Argon2
 * verify on the unknown-email path so timing does not reveal account existence (§3.13).
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly identities: IdentitiesRepository,
    private readonly hasher: PasswordHasher,
    private readonly memberships: AuthMembershipRepository,
    private readonly sessionIssuer: SessionIssuer,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async login(input: LoginInput): Promise<IssuedTokens> {
    const email = input.email.trim().toLowerCase();
    const identity = await this.identities.findPasswordIdentityByEmail(email);

    if (!identity || identity.secretHash === null) {
      await this.hasher.verifyAgainstDummy(input.password);
      throw new UnauthenticatedError('Invalid email or password');
    }

    const passwordOk = await this.hasher.verify(identity.secretHash, input.password);
    if (!passwordOk || identity.principalStatus !== 'active') {
      // Suspended principals fail identically — never reveal account state.
      throw new UnauthenticatedError('Invalid email or password');
    }

    const active = selectActiveMembership(
      await this.memberships.findActiveForPrincipal(identity.principalId),
    );
    if (!active) {
      throw new UnauthenticatedError('Invalid email or password');
    }

    return withTenantTransaction(
      this.db,
      { organizationId: active.organizationId, workspaceId: active.workspaceId },
      async (tx) => {
        await this.identities.touchLastAuthenticated(tx, identity.identityId);

        const tokens = await this.sessionIssuer.issue(tx, {
          principalId: identity.principalId,
          tokenVersion: identity.tokenVersion,
          organizationId: active.organizationId,
          workspaceId: active.workspaceId,
          client: input.client,
        });

        const eventBase = {
          organizationId: active.organizationId,
          workspaceId: active.workspaceId,
          actorPrincipalId: identity.principalId,
          correlationId: input.correlationId,
          causationId: null,
        };
        await this.outbox.append(tx, {
          ...eventBase,
          aggregateType: IdentityAggregateType.User,
          aggregateId: identity.principalId,
          type: IdentityEventType.UserAuthenticated,
          payload: { principalId: identity.principalId, method: 'password' },
        });
        await this.outbox.append(tx, {
          ...eventBase,
          aggregateType: IdentityAggregateType.Session,
          aggregateId: tokens.sessionId,
          type: IdentityEventType.SessionCreated,
          payload: { sessionId: tokens.sessionId, familyId: tokens.familyId },
        });

        return tokens;
      },
    );
  }
}
