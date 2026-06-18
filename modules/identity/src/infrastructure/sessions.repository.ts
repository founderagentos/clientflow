import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, desc, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Executor, type Tx } from '@agentos/persistence-kernel';
import type { SessionRevocationReason } from '@agentos/contracts';
import { sessions } from './sessions.schema';

/** Active tenant context + token-version pinned to a session at login, read back on refresh
 * (§3.11). `tokenVersion` is the principal's value at issue; a mismatch with the principal's
 * current value at refresh means a global invalidation (password change / logout-all) occurred. */
export interface SessionMetadata {
  activeOrganizationId: string;
  activeWorkspaceId: string | null;
  tokenVersion: number;
}

export interface SessionRecord {
  id: string;
  principalId: string;
  familyId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  metadata: SessionMetadata;
}

export interface ActiveSessionSummary {
  id: string;
  familyId: string;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  issuedAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

function revocationPatch(reason: SessionRevocationReason) {
  // jsonb concat preserves the pinned active org/ws while recording why the session ended.
  return sql`${sessions.metadata} || ${JSON.stringify({ revocationReason: reason })}::jsonb`;
}

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insert(
    tx: Tx,
    input: {
      principalId: string;
      refreshTokenHash: string;
      familyId: string;
      expiresAt: Date;
      activeOrganizationId: string;
      activeWorkspaceId: string | null;
      tokenVersion: number;
      deviceLabel?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<string> {
    const [row] = await tx
      .insert(sessions)
      .values({
        principalId: input.principalId,
        refreshTokenHash: input.refreshTokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
        deviceLabel: input.deviceLabel ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: {
          activeOrganizationId: input.activeOrganizationId,
          activeWorkspaceId: input.activeWorkspaceId,
          tokenVersion: input.tokenVersion,
        } satisfies SessionMetadata,
      })
      .returning({ id: sessions.id });
    return row!.id;
  }

  async findByRefreshHash(
    refreshTokenHash: string,
    executor: Executor = this.db,
  ): Promise<SessionRecord | null> {
    const [row] = await executor
      .select({
        id: sessions.id,
        principalId: sessions.principalId,
        familyId: sessions.familyId,
        revokedAt: sessions.revokedAt,
        expiresAt: sessions.expiresAt,
        metadata: sessions.metadata,
      })
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, refreshTokenHash))
      .limit(1);
    if (!row) {
      return null;
    }
    return { ...row, metadata: row.metadata as SessionMetadata };
  }

  /**
   * Compare-and-swap consume: flips `revoked_at` only if still null. Returns true iff THIS
   * call won — a concurrent refresh of the same token gets `false`, which the service treats
   * as reuse, closing the double-spend race without a lock.
   */
  async consume(tx: Tx, sessionId: string): Promise<boolean> {
    const now = new Date();
    const rows = await tx
      .update(sessions)
      .set({ revokedAt: now, lastUsedAt: now, updatedAt: now, metadata: revocationPatch('rotated') })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length === 1;
  }

  /** Revoke every still-active session in a family (theft response / logout). Returns count. */
  async revokeFamily(
    tx: Tx,
    familyId: string,
    reason: SessionRevocationReason,
  ): Promise<number> {
    const rows = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), updatedAt: new Date(), metadata: revocationPatch(reason) })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  /** Revoke a session's family, but only if the session belongs to the given principal. */
  async revokeFamilyForPrincipal(
    tx: Tx,
    sessionId: string,
    principalId: string,
    reason: SessionRevocationReason,
  ): Promise<{ familyId: string; revoked: number } | null> {
    const [owned] = await tx
      .select({ familyId: sessions.familyId, principalId: sessions.principalId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!owned || owned.principalId !== principalId) {
      return null;
    }
    const revoked = await this.revokeFamily(tx, owned.familyId, reason);
    return { familyId: owned.familyId, revoked };
  }

  async listActiveByPrincipal(
    principalId: string,
    executor: Executor = this.db,
  ): Promise<ActiveSessionSummary[]> {
    return executor
      .select({
        id: sessions.id,
        familyId: sessions.familyId,
        deviceLabel: sessions.deviceLabel,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        issuedAt: sessions.issuedAt,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.principalId, principalId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.issuedAt));
  }
}
