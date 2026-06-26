import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictError } from '@agentos/result-errors';
import { newId } from '@agentos/identifier';
import { softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import { accountContacts } from './account-contacts.schema';

export interface AccountContactRow {
  id: string;
  accountId: string;
  contactId: string;
  relationshipRole: string | null;
  isPrimary: boolean;
}

const UNIQUE_VIOLATION = '23505';
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION
  );
}

const ROW = {
  id: accountContacts.id,
  accountId: accountContacts.accountId,
  contactId: accountContacts.contactId,
  relationshipRole: accountContacts.relationshipRole,
  isPrimary: accountContacts.isPrimary,
};

/**
 * The Account↔Contact relationship table (RFC-002 §2.2). Full column contract: unlinking is a soft
 * delete, never a hard DELETE. The ≤1-primary-contact-per-account invariant is held by the Phase-1
 * partial unique `account_contacts_one_primary_per_account_key`; `setPrimary` demotes the current
 * primary in the same tx so the new one never collides.
 */
@Injectable()
export class AccountContactsRepository {
  async findLink(tx: Tx, accountId: string, contactId: string): Promise<AccountContactRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(accountContacts)
      .where(
        and(
          eq(accountContacts.accountId, accountId),
          eq(accountContacts.contactId, contactId),
          isNull(accountContacts.deletedAt),
        ),
      )
      .limit(1);
    return (row as AccountContactRow | undefined) ?? null;
  }

  async listByAccount(tx: Tx, accountId: string): Promise<AccountContactRow[]> {
    return tx
      .select(ROW)
      .from(accountContacts)
      .where(and(eq(accountContacts.accountId, accountId), isNull(accountContacts.deletedAt)))
      .orderBy(accountContacts.createdAt) as Promise<AccountContactRow[]>;
  }

  /** The active primary link for an account, if any. */
  async findPrimary(tx: Tx, accountId: string): Promise<AccountContactRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(accountContacts)
      .where(
        and(
          eq(accountContacts.accountId, accountId),
          eq(accountContacts.isPrimary, true),
          isNull(accountContacts.deletedAt),
        ),
      )
      .limit(1);
    return (row as AccountContactRow | undefined) ?? null;
  }

  async link(
    tx: Tx,
    input: {
      organizationId: string;
      workspaceId: string;
      accountId: string;
      contactId: string;
      relationshipRole: string | null;
      isPrimary: boolean;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    try {
      await tx.insert(accountContacts).values({
        id: newId(),
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        contactId: input.contactId,
        relationshipRole: input.relationshipRole,
        isPrimary: input.isPrimary,
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('This contact is already linked to the account');
      }
      throw error;
    }
  }

  /** Flip `is_primary` on a single active link (used by setPrimary for demote + promote). */
  async setPrimaryFlag(
    tx: Tx,
    input: { accountId: string; contactId: string; isPrimary: boolean; actorPrincipalId: string },
  ): Promise<void> {
    await tx
      .update(accountContacts)
      .set({ isPrimary: input.isPrimary, updatedAt: new Date(), updatedBy: input.actorPrincipalId })
      .where(
        and(
          eq(accountContacts.accountId, input.accountId),
          eq(accountContacts.contactId, input.contactId),
          isNull(accountContacts.deletedAt),
        ),
      );
  }

  async unlink(
    tx: Tx,
    input: { accountId: string; contactId: string; actorPrincipalId: string },
  ): Promise<void> {
    await tx
      .update(accountContacts)
      .set(softDeletePatch(input.actorPrincipalId))
      .where(
        and(
          eq(accountContacts.accountId, input.accountId),
          eq(accountContacts.contactId, input.contactId),
          isNull(accountContacts.deletedAt),
        ),
      );
  }

  /** Archive-cascade: soft-delete every active link of an account (when the account is archived). */
  async softDeleteForAccount(tx: Tx, accountId: string, actorPrincipalId: string): Promise<void> {
    await tx
      .update(accountContacts)
      .set(softDeletePatch(actorPrincipalId))
      .where(and(eq(accountContacts.accountId, accountId), isNull(accountContacts.deletedAt)));
  }

  /** Archive-cascade: soft-delete every active link of a contact (when the contact is archived). */
  async softDeleteForContact(tx: Tx, contactId: string, actorPrincipalId: string): Promise<void> {
    await tx
      .update(accountContacts)
      .set(softDeletePatch(actorPrincipalId))
      .where(and(eq(accountContacts.contactId, contactId), isNull(accountContacts.deletedAt)));
  }
}
