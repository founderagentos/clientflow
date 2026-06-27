import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { assertVersionMatched, nextVersion, softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import { contacts } from './contacts.schema';
import { erasurePatch } from '../domain/contact-erasure';

export interface ContactRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  firstName: string | null;
  lastName: string | null;
  emails: unknown;
  phones: unknown;
  primaryEmailNormalized: string | null;
  title: string | null;
  ownerPrincipalId: string | null;
  erasedAt: Date | null;
  customFields: unknown;
  version: number;
  createdAt: Date;
}

export interface ContactKeysetCursor {
  createdAt: Date;
  id: string;
}

export interface ContactInsert {
  id: string;
  organizationId: string;
  workspaceId: string;
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  phones: string[];
  primaryEmailNormalized: string | null;
  title: string | null;
  ownerPrincipalId: string | null;
  customFields: Record<string, unknown>;
  actorPrincipalId: string;
}

export interface ContactUpdatableFields {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  emails?: string[] | undefined;
  phones?: string[] | undefined;
  primaryEmailNormalized?: string | null | undefined;
  title?: string | null | undefined;
  ownerPrincipalId?: string | null | undefined;
  customFields?: Record<string, unknown> | undefined;
}

const ROW = {
  id: contacts.id,
  organizationId: contacts.organizationId,
  workspaceId: contacts.workspaceId,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  emails: contacts.emails,
  phones: contacts.phones,
  primaryEmailNormalized: contacts.primaryEmailNormalized,
  title: contacts.title,
  ownerPrincipalId: contacts.ownerPrincipalId,
  erasedAt: contacts.erasedAt,
  customFields: contacts.customFields,
  version: contacts.version,
  createdAt: contacts.createdAt,
};

/**
 * Reads/writes `contacts` within the active org+workspace (RLS scopes every statement). Holds PII;
 * the `erase` path purges it while leaving a referentially-valid tombstone (RFC-002 §8.4).
 */
@Injectable()
export class ContactsRepository {
  async findById(tx: Tx, id: string): Promise<ContactRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .limit(1);
    return (row as ContactRow | undefined) ?? null;
  }

  async listByWorkspace(
    tx: Tx,
    limit: number,
    cursor?: ContactKeysetCursor,
    ownerPrincipalId?: string,
  ): Promise<ContactRow[]> {
    const conditions = [isNull(contacts.deletedAt)];
    if (ownerPrincipalId) {
      conditions.push(eq(contacts.ownerPrincipalId, ownerPrincipalId));
    }
    if (cursor) {
      conditions.push(
        or(
          lt(contacts.createdAt, cursor.createdAt),
          and(eq(contacts.createdAt, cursor.createdAt), lt(contacts.id, cursor.id)),
        )!,
      );
    }
    return tx
      .select(ROW)
      .from(contacts)
      .where(and(...conditions))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(limit) as Promise<ContactRow[]>;
  }

  /**
   * The active contact whose `primary_email_normalized` matches, if any — the Phase-4 conversion
   * match signal (RFC §4.C). `emailNormalized` must be pre-normalized by the caller; never matches
   * a null value (no signal to match on).
   */
  async findActiveByEmailNormalized(tx: Tx, emailNormalized: string): Promise<ContactRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(contacts)
      .where(
        and(eq(contacts.primaryEmailNormalized, emailNormalized), isNull(contacts.deletedAt)),
      )
      .limit(1);
    return (row as ContactRow | undefined) ?? null;
  }

  async insert(tx: Tx, input: ContactInsert): Promise<void> {
    await tx.insert(contacts).values({
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      firstName: input.firstName,
      lastName: input.lastName,
      emails: input.emails,
      phones: input.phones,
      primaryEmailNormalized: input.primaryEmailNormalized,
      title: input.title,
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
      fields: ContactUpdatableFields;
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as keyof ContactUpdatableFields] !== undefined,
    );
    const rows = await tx
      .update(contacts)
      .set({
        ...input.fields,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(
        and(
          eq(contacts.id, input.id),
          eq(contacts.version, input.expectedVersion),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id });
    assertVersionMatched(rows.length);
    return changed;
  }

  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(contacts)
      .set({
        ...softDeletePatch(input.actorPrincipalId),
        version: nextVersion(input.expectedVersion),
      })
      .where(
        and(
          eq(contacts.id, input.id),
          eq(contacts.version, input.expectedVersion),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id });
    assertVersionMatched(rows.length);
  }

  /**
   * Erase PII (RFC-002 §8.4), optimistic-locked. Purges the PII columns and sets `erased_at`, but
   * does NOT set `deleted_at` — the row remains a referentially-valid tombstone so Deals / history /
   * `account_contacts` referencing it stay valid.
   */
  async erase(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(contacts)
      .set({
        ...erasurePatch(),
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(
        and(
          eq(contacts.id, input.id),
          eq(contacts.version, input.expectedVersion),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id });
    assertVersionMatched(rows.length);
  }
}
