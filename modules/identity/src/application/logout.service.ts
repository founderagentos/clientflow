import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import {
  IdentityAggregateType,
  IdentityEventType,
  SessionRevocationReason,
} from '@agentos/contracts';
import { hashRefreshToken } from '../domain/refresh-token';
import { SessionsRepository } from '../infrastructure/sessions.repository';

/**
 * Revokes the family of the presented refresh token (CLAUDE.md §3.12). Idempotent: an unknown
 * or already-revoked token is a no-op success, so logout never leaks whether a token existed.
 */
@Injectable()
export class LogoutService {
  constructor(
    private readonly sessions: SessionsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async logout(input: { refreshToken: string; correlationId: string }): Promise<void> {
    const session = await this.sessions.findByRefreshHash(hashRefreshToken(input.refreshToken));
    if (!session) {
      return;
    }
    const meta = session.metadata;
    await withTenantTransaction(
      this.db,
      { organizationId: meta.activeOrganizationId, workspaceId: meta.activeWorkspaceId },
      async (tx) => {
        const revoked = await this.sessions.revokeFamily(
          tx,
          session.familyId,
          SessionRevocationReason.LoggedOut,
        );
        if (revoked > 0) {
          await this.outbox.append(tx, {
            organizationId: meta.activeOrganizationId,
            workspaceId: meta.activeWorkspaceId,
            actorPrincipalId: session.principalId,
            correlationId: input.correlationId,
            causationId: null,
            aggregateType: IdentityAggregateType.Session,
            aggregateId: session.id,
            type: IdentityEventType.SessionRevoked,
            payload: {
              sessionId: session.id,
              familyId: session.familyId,
              reason: SessionRevocationReason.LoggedOut,
            },
          });
        }
      },
    );
  }
}
