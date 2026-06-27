import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { assertVersionMatched, nextVersion, softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import { accounts } from './accounts.schema';

export interface AccountRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  sizeBand: string | null;
  address: unknown;
  ownerPrincipalId: string | null;
  customFields: unknown;
  version: number;
  createdAt: Date;
}

export interface AccountKeysetCursor {
  createdAt: Date;
  id: string;
}

export interface AccountInsert {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  sizeBand: string | null;
  address: Record<string, unknown>;
  ownerPrincipalId: string | null;
  customFields: Record<string, unknown>;
  actorPrincipalId: string;
}

export interface AccountUpdatableFields {
  name?: string | undefined;
  domain?: string | null | undefined;
  industry?: string | null | undefined;
  sizeBand?: string | null | undefined;
  address?: Record<string, unknown> | undefined;
  ownerPrincipalId?: string | null | undefined;
  customFields?: Record<string, unknown> | undefined;
}

const ROW = {
  id: accounts.id,
  organizationId: accounts.organizationId,
  workspaceId: accounts.workspaceId,
  name: accounts.name,
  domain: accounts.domain,
  industry: accounts.industry,
  sizeBand: accounts.sizeBand,
  address: accounts.address,
  ownerPrincipalId: accounts.ownerPrincipalId,
  customFields: accounts.customFields,
  version: accounts.version,
  createdAt: accounts.createdAt,
};

/**
 * Reads/writes `accounts` within the active org+workspace (RLS scopes every statement). Every method
 * takes a caller-owned {@link Tx}. Soft delete + optimistic lock via the kernel write-helpers.
 */
@Injectable()
export class AccountsRepository {
  async findById(tx: Tx, id: string): Promise<AccountRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
      .limit(1);
    return (row as AccountRow | undefined) ?? null;
  }

  /**
   * Keyset page newest-first on `(created_at, id)` — uses `accounts_org_ws_created_id_idx`. When
   * `ownerPrincipalId` is set the page is narrowed to that owner (RFC §8.2 ownership scoping).
   */
  async listByWorkspace(
    tx: Tx,
    limit: number,
    cursor?: AccountKeysetCursor,
    ownerPrincipalId?: string,
  ): Promise<AccountRow[]> {
    const conditions = [isNull(accounts.deletedAt)];
    if (ownerPrincipalId) {
      conditions.push(eq(accounts.ownerPrincipalId, ownerPrincipalId));
    }
    if (cursor) {
      conditions.push(
        or(
          lt(accounts.createdAt, cursor.createdAt),
          and(eq(accounts.createdAt, cursor.createdAt), lt(accounts.id, cursor.id)),
        )!,
      );
    }
    return tx
      .select(ROW)
      .from(accounts)
      .where(and(...conditions))
      .orderBy(desc(accounts.createdAt), desc(accounts.id))
      .limit(limit) as Promise<AccountRow[]>;
  }

  /**
   * The active account whose normalized `domain` matches, if any — the Phase-4 conversion match
   * signal (RFC §4.C). `domain` must be pre-normalized by the caller; never matches a null domain
   * (no signal to match on).
   */
  async findActiveByDomain(tx: Tx, domain: string): Promise<AccountRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(accounts)
      .where(and(eq(accounts.domain, domain), isNull(accounts.deletedAt)))
      .limit(1);
    return (row as AccountRow | undefined) ?? null;
  }

  async insert(tx: Tx, input: AccountInsert): Promise<void> {
    await tx.insert(accounts).values({
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: input.name,
      domain: input.domain,
      industry: input.industry,
      sizeBand: input.sizeBand,
      address: input.address,
      ownerPrincipalId: input.ownerPrincipalId,
      customFields: input.customFields,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
  }

  /** Optimistic-locked field update. Returns the changed field names. */
  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: AccountUpdatableFields;
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as keyof AccountUpdatableFields] !== undefined,
    );
    const rows = await tx
      .update(accounts)
      .set({
        ...input.fields,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(
        and(
          eq(accounts.id, input.id),
          eq(accounts.version, input.expectedVersion),
          isNull(accounts.deletedAt),
        ),
      )
      .returning({ id: accounts.id });
    assertVersionMatched(rows.length);
    return changed;
  }

  /** Soft-delete, optimistic-locked. The open-Deal guard is enforced in the service before this. */
  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(accounts)
      .set({
        ...softDeletePatch(input.actorPrincipalId),
        version: nextVersion(input.expectedVersion),
      })
      .where(
        and(
          eq(accounts.id, input.id),
          eq(accounts.version, input.expectedVersion),
          isNull(accounts.deletedAt),
        ),
      )
      .returning({ id: accounts.id });
    assertVersionMatched(rows.length);
  }
}
