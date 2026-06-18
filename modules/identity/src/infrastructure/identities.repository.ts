import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE, type Database, type Executor, type Tx } from '@agentos/persistence-kernel';
import { identities } from './identities.schema';
import { principals } from './principals.schema';

const PASSWORD_PROVIDER = 'password';

export interface PasswordIdentityRow {
  identityId: string;
  principalId: string;
  secretHash: string | null;
  principalStatus: string;
  tokenVersion: number;
}

@Injectable()
export class IdentitiesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `provider_subject` is the normalized (lower-cased) email — `identities.provider_subject`
   * is plain text, so normalization happens at the call site, not via citext. */
  async insertPassword(
    tx: Tx,
    input: { userId: string; providerSubject: string; secretHash: string },
  ): Promise<string> {
    const [row] = await tx
      .insert(identities)
      .values({
        userId: input.userId,
        provider: PASSWORD_PROVIDER,
        providerSubject: input.providerSubject,
        secretHash: input.secretHash,
      })
      .returning({ id: identities.id });
    return row!.id;
  }

  /**
   * Resolve a password identity + its principal in one query (principals.id == users.id ==
   * identities.user_id, the shared-PK chain). Global tables, no RLS — safe to read pre-auth.
   */
  async findPasswordIdentityByEmail(
    providerSubject: string,
    executor: Executor = this.db,
  ): Promise<PasswordIdentityRow | null> {
    const [row] = await executor
      .select({
        identityId: identities.id,
        principalId: identities.userId,
        secretHash: identities.secretHash,
        principalStatus: principals.status,
        tokenVersion: principals.tokenVersion,
      })
      .from(identities)
      .innerJoin(principals, eq(principals.id, identities.userId))
      .where(
        and(
          eq(identities.provider, PASSWORD_PROVIDER),
          eq(identities.providerSubject, providerSubject),
          isNull(identities.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async touchLastAuthenticated(tx: Tx, identityId: string): Promise<void> {
    await tx
      .update(identities)
      .set({ lastAuthenticatedAt: new Date(), updatedAt: new Date() })
      .where(eq(identities.id, identityId));
  }
}
