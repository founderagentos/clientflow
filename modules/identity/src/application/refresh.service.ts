import { Inject, Injectable } from '@nestjs/common';
import { UnauthenticatedError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
  type Tx,
} from '@agentos/persistence-kernel';
import {
  IdentityAggregateType,
  IdentityEventType,
  SessionRevocationReason,
} from '@agentos/contracts';
import { hashRefreshToken } from '../domain/refresh-token';
import { decideRefresh } from '../domain/session-rotation';
import {
  SessionsRepository,
  type SessionMetadata,
  type SessionRecord,
} from '../infrastructure/sessions.repository';
import { PrincipalsRepository } from '../infrastructure/principals.repository';
import { SessionIssuer, type ClientMeta, type IssuedTokens } from './session-issuer';

export interface RefreshInput {
  refreshToken: string;
  correlationId: string;
  client?: ClientMeta;
}

@Injectable()
export class RefreshService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly principals: PrincipalsRepository,
    private readonly sessionIssuer: SessionIssuer,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async refresh(input: RefreshInput): Promise<IssuedTokens> {
    const presentedHash = hashRefreshToken(input.refreshToken);
    const session = await this.sessions.findByRefreshHash(presentedHash);
    const decision = decideRefresh(
      session
        ? {
            id: session.id,
            familyId: session.familyId,
            principalId: session.principalId,
            revokedAt: session.revokedAt,
            expiresAt: session.expiresAt,
          }
        : null,
      new Date(),
    );

    if (decision.kind === 'not_found' || decision.kind === 'expired') {
      throw new UnauthenticatedError('Invalid or expired refresh token');
    }

    if (decision.kind === 'reuse_detected') {
      // session is non-null here (decideRefresh only returns reuse for a found, revoked session).
      await this.revokeFamilyForReuse(
        session as SessionRecord,
        decision.presentedSessionId,
        input.correlationId,
      );
      throw new UnauthenticatedError('Refresh token reuse detected; sessions revoked');
    }

    // decision.kind === 'rotate'
    const found = session as SessionRecord;
    const principal = await this.principals.findById(found.principalId);
    const meta = found.metadata;

    // Revoke paths MUST commit before we throw, so the family revocation persists. We return a
    // discriminated outcome from the transaction and translate it to an error afterward.
    const outcome = await withTenantTransaction(
      this.db,
      { organizationId: meta.activeOrganizationId, workspaceId: meta.activeWorkspaceId },
      async (tx): Promise<{ kind: 'rotated'; tokens: IssuedTokens } | { kind: 'reuse' } | { kind: 'stale' }> => {
        const won = await this.sessions.consume(tx, found.id);
        if (!won) {
          // Lost the compare-and-swap → a concurrent refresh already consumed this token: reuse.
          await this.emitReuse(tx, found, meta, found.id, input.correlationId);
          return { kind: 'reuse' };
        }

        if (!principal || principal.status !== 'active' || principal.tokenVersion !== meta.tokenVersion) {
          // Global invalidation (password change / logout-all) or suspended principal.
          const revoked = await this.sessions.revokeFamily(
            tx,
            found.familyId,
            SessionRevocationReason.TokenVersionBumped,
          );
          if (revoked > 0) {
            await this.outbox.append(tx, {
              ...this.eventBase(found, meta, input.correlationId),
              aggregateType: IdentityAggregateType.Session,
              aggregateId: found.id,
              type: IdentityEventType.SessionRevoked,
              payload: {
                sessionId: found.id,
                familyId: found.familyId,
                reason: SessionRevocationReason.TokenVersionBumped,
              },
            });
          }
          return { kind: 'stale' };
        }

        const tokens = await this.sessionIssuer.issue(tx, {
          principalId: found.principalId,
          tokenVersion: principal.tokenVersion,
          organizationId: meta.activeOrganizationId,
          workspaceId: meta.activeWorkspaceId,
          familyId: found.familyId,
          client: input.client,
        });
        await this.outbox.append(tx, {
          ...this.eventBase(found, meta, input.correlationId),
          aggregateType: IdentityAggregateType.Session,
          aggregateId: tokens.sessionId,
          type: IdentityEventType.TokenRefreshed,
          payload: {
            sessionId: tokens.sessionId,
            familyId: found.familyId,
            previousSessionId: found.id,
          },
        });
        return { kind: 'rotated', tokens };
      },
    );

    if (outcome.kind === 'reuse') {
      throw new UnauthenticatedError('Refresh token reuse detected; sessions revoked');
    }
    if (outcome.kind === 'stale') {
      throw new UnauthenticatedError('Session is no longer valid');
    }
    return outcome.tokens;
  }

  private eventBase(session: SessionRecord, meta: SessionMetadata, correlationId: string) {
    return {
      organizationId: meta.activeOrganizationId,
      workspaceId: meta.activeWorkspaceId,
      actorPrincipalId: session.principalId,
      correlationId,
      causationId: null as string | null,
    };
  }

  private async emitReuse(
    tx: Tx,
    session: SessionRecord,
    meta: SessionMetadata,
    presentedSessionId: string,
    correlationId: string,
  ): Promise<void> {
    const revoked = await this.sessions.revokeFamily(
      tx,
      session.familyId,
      SessionRevocationReason.ReuseDetected,
    );
    await this.outbox.append(tx, {
      ...this.eventBase(session, meta, correlationId),
      aggregateType: IdentityAggregateType.Session,
      aggregateId: session.familyId,
      type: IdentityEventType.RefreshTokenReuseDetected,
      payload: { familyId: session.familyId, presentedSessionId, revokedSessionCount: revoked },
    });
  }

  /** Reuse detected on an already-revoked token: revoke the family in a committed transaction,
   * then the caller throws. */
  private async revokeFamilyForReuse(
    session: SessionRecord,
    presentedSessionId: string,
    correlationId: string,
  ): Promise<void> {
    const meta = session.metadata;
    await withTenantTransaction(
      this.db,
      { organizationId: meta.activeOrganizationId, workspaceId: meta.activeWorkspaceId },
      async (tx) => {
        await this.emitReuse(tx, session, meta, presentedSessionId, correlationId);
      },
    );
  }
}
