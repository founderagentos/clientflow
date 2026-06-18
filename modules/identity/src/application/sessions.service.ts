import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
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
import {
  SessionsRepository,
  type ActiveSessionSummary,
} from '../infrastructure/sessions.repository';

export interface RevokeContext {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  correlationId: string;
}

/** Authenticated self-service over a principal's own sessions (CLAUDE.md §3.12). */
@Injectable()
export class SessionsService {
  constructor(
    private readonly sessions: SessionsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  list(principalId: string): Promise<ActiveSessionSummary[]> {
    return this.sessions.listActiveByPrincipal(principalId);
  }

  /** Revoke a specific session's family. 404 (not 403) if it isn't the caller's — never
   * confirm another principal's session exists (§3.8). */
  async revoke(sessionId: string, ctx: RevokeContext): Promise<void> {
    await withTenantTransaction(
      this.db,
      { organizationId: ctx.organizationId, workspaceId: ctx.workspaceId },
      async (tx) => {
        const result = await this.sessions.revokeFamilyForPrincipal(
          tx,
          sessionId,
          ctx.principalId,
          SessionRevocationReason.LoggedOut,
        );
        if (!result) {
          throw new NotFoundError('Session not found');
        }
        if (result.revoked > 0) {
          await this.outbox.append(tx, {
            organizationId: ctx.organizationId,
            workspaceId: ctx.workspaceId,
            actorPrincipalId: ctx.principalId,
            correlationId: ctx.correlationId,
            causationId: null,
            aggregateType: IdentityAggregateType.Session,
            aggregateId: sessionId,
            type: IdentityEventType.SessionRevoked,
            payload: {
              sessionId,
              familyId: result.familyId,
              reason: SessionRevocationReason.LoggedOut,
            },
          });
        }
      },
    );
  }
}
