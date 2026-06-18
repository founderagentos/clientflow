import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@agentos/identifier';
import type { Tx } from '@agentos/persistence-kernel';
import { mintRefreshToken, hashRefreshToken } from '../domain/refresh-token';
import { AccessTokenService } from '../infrastructure/ed25519-token-service';
import { SessionsRepository } from '../infrastructure/sessions.repository';
import { IDENTITY_AUTH_CONFIG, type IdentityAuthConfig } from '../infrastructure/identity-auth.config';

export interface ClientMeta {
  deviceLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssueSessionInput {
  principalId: string;
  tokenVersion: number;
  organizationId: string;
  workspaceId: string | null;
  /** Reuse to keep a rotated token in the same family; omit to start a new family. */
  familyId?: string;
  client?: ClientMeta | undefined;
}

export interface IssuedTokens {
  accessToken: string;
  /** Plaintext refresh token — returned to the client exactly once; only its hash is stored. */
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresAt: Date;
  sessionId: string;
  familyId: string;
}

/**
 * Creates a session row and the access+refresh token pair for it (CLAUDE.md §3.11/§3.12).
 * Deliberately event-free: the caller (login / registration / refresh) appends the
 * context-appropriate outbox event (SessionCreated vs TokenRefreshed) in the same transaction.
 */
@Injectable()
export class SessionIssuer {
  constructor(
    private readonly tokenService: AccessTokenService,
    private readonly sessions: SessionsRepository,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  async issue(tx: Tx, input: IssueSessionInput): Promise<IssuedTokens> {
    const familyId = input.familyId ?? newId();
    const refreshToken = mintRefreshToken();
    const refreshTokenExpiresAt = new Date(Date.now() + this.config.refreshTtlSeconds * 1000);

    const sessionId = await this.sessions.insert(tx, {
      principalId: input.principalId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: refreshTokenExpiresAt,
      activeOrganizationId: input.organizationId,
      activeWorkspaceId: input.workspaceId,
      tokenVersion: input.tokenVersion,
      deviceLabel: input.client?.deviceLabel ?? null,
      ip: input.client?.ip ?? null,
      userAgent: input.client?.userAgent ?? null,
    });

    const access = await this.tokenService.issue({
      principalId: input.principalId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      tokenVersion: input.tokenVersion,
    });

    return {
      accessToken: access.token,
      refreshToken,
      accessTokenExpiresInSeconds: access.expiresInSeconds,
      refreshTokenExpiresAt,
      sessionId,
      familyId,
    };
  }
}
