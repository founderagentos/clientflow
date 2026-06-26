import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { assertVersionMatched, nextVersion, softDeletePatch, type Tx } from '@agentos/persistence-kernel';
import type { LeadStatus } from '@agentos/contracts';
import { leads } from './leads.schema';

export interface LeadRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  status: string;
  source: string | null;
  name: string | null;
  email: string | null;
  emailNormalized: string | null;
  phoneE164: string | null;
  domain: string | null;
  score: number | null;
  ownerPrincipalId: string | null;
  convertedAt: Date | null;
  convertedAccountId: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  mergedIntoLeadId: string | null;
  customFields: unknown;
  version: number;
  createdAt: Date;
}

export interface LeadKeysetCursor {
  createdAt: Date;
  id: string;
}

export interface LeadInsert {
  id: string;
  organizationId: string;
  workspaceId: string;
  status: LeadStatus;
  source: string | null;
  name: string | null;
  email: string | null;
  emailNormalized: string | null;
  phoneE164: string | null;
  domain: string | null;
  ownerPrincipalId: string | null;
  customFields: Record<string, unknown>;
  actorPrincipalId: string;
}

export interface LeadUpdatableFields {
  source?: string | null | undefined;
  name?: string | null | undefined;
  email?: string | null | undefined;
  emailNormalized?: string | null | undefined;
  phoneE164?: string | null | undefined;
  domain?: string | null | undefined;
  score?: number | null | undefined;
  ownerPrincipalId?: string | null | undefined;
  customFields?: Record<string, unknown> | undefined;
}

const ROW = {
  id: leads.id,
  organizationId: leads.organizationId,
  workspaceId: leads.workspaceId,
  status: leads.status,
  source: leads.source,
  name: leads.name,
  email: leads.email,
  emailNormalized: leads.emailNormalized,
  phoneE164: leads.phoneE164,
  domain: leads.domain,
  score: leads.score,
  ownerPrincipalId: leads.ownerPrincipalId,
  convertedAt: leads.convertedAt,
  convertedAccountId: leads.convertedAccountId,
  convertedContactId: leads.convertedContactId,
  convertedDealId: leads.convertedDealId,
  mergedIntoLeadId: leads.mergedIntoLeadId,
  customFields: leads.customFields,
  version: leads.version,
  createdAt: leads.createdAt,
};

/**
 * Reads/writes `leads` within the active org+workspace (RLS scopes every statement). Every method
 * takes a caller-owned {@link Tx}. `markConverted` and `softDeleteMergedInto` both guard on
 * `expectedVersion` — a 0-row update means either a stale version or (for `markConverted`) a
 * concurrent racing conversion; either way `assertVersionMatched` throws `OptimisticLockError`,
 * which aborts the orchestrator's whole transaction and rolls back its newly-created Account/
 * Contact/Deal atomically (no orphans under a race — RFC's literal gate is sequential replay, but
 * this keeps the concurrent case safe too).
 */
@Injectable()
export class LeadsRepository {
  async findById(tx: Tx, id: string): Promise<LeadRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1);
    return (row as LeadRow | undefined) ?? null;
  }

  /** Keyset page newest-first on `(created_at, id)` — uses `leads_org_ws_created_id_idx`. */
  async listByWorkspace(tx: Tx, limit: number, cursor?: LeadKeysetCursor): Promise<LeadRow[]> {
    const where = cursor
      ? and(
          isNull(leads.deletedAt),
          or(
            lt(leads.createdAt, cursor.createdAt),
            and(eq(leads.createdAt, cursor.createdAt), lt(leads.id, cursor.id)),
          ),
        )
      : isNull(leads.deletedAt);
    return tx
      .select(ROW)
      .from(leads)
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(limit) as Promise<LeadRow[]>;
  }

  /** Active (non-deleted) leads sharing a normalized domain — the conversion match signal. */
  async listActiveByDomain(tx: Tx, domain: string): Promise<LeadRow[]> {
    return tx
      .select(ROW)
      .from(leads)
      .where(and(eq(leads.domain, domain), isNull(leads.deletedAt))) as Promise<LeadRow[]>;
  }

  /**
   * The active lead whose `email_normalized` matches, if any — the bulk-import dedup signal (RFC
   * §4.B/§6.2). `emailNormalized` must be pre-normalized by the caller; never matches a null value.
   * A *signal*, never a unique constraint (§11) — duplicates are legitimate; the import *policy*
   * (skip-on-match) decides what to do, not the DB.
   */
  async findActiveByEmailNormalized(tx: Tx, emailNormalized: string): Promise<LeadRow | null> {
    const [row] = await tx
      .select(ROW)
      .from(leads)
      .where(and(eq(leads.emailNormalized, emailNormalized), isNull(leads.deletedAt)))
      .limit(1);
    return (row as LeadRow | undefined) ?? null;
  }

  async insert(tx: Tx, input: LeadInsert): Promise<void> {
    await tx.insert(leads).values({
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      status: input.status,
      source: input.source,
      name: input.name,
      email: input.email,
      emailNormalized: input.emailNormalized,
      phoneE164: input.phoneE164,
      domain: input.domain,
      ownerPrincipalId: input.ownerPrincipalId,
      customFields: input.customFields,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
  }

  /** Optimistic-locked field update (status changes go through `changeStatus`, not this). */
  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: LeadUpdatableFields;
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as keyof LeadUpdatableFields] !== undefined,
    );
    const rows = await tx
      .update(leads)
      .set({
        ...input.fields,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: leads.id });
    assertVersionMatched(rows.length);
    return changed;
  }

  async assign(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      ownerPrincipalId: string | null;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    const rows = await tx
      .update(leads)
      .set({
        ownerPrincipalId: input.ownerPrincipalId,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: leads.id });
    assertVersionMatched(rows.length);
  }

  async changeStatus(
    tx: Tx,
    input: { id: string; expectedVersion: number; status: LeadStatus; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(leads)
      .set({
        status: input.status,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: leads.id });
    assertVersionMatched(rows.length);
  }

  /**
   * Write-once conversion pointers (RFC §6.2): sets `converted_at` + the three produced ids and
   * `status = qualified`. Guarded by `expectedVersion` AND `converted_at IS NULL` — see class doc.
   */
  async markConverted(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      accountId: string;
      contactId: string;
      dealId: string;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    const rows = await tx
      .update(leads)
      .set({
        status: 'qualified',
        convertedAt: new Date(),
        convertedAccountId: input.accountId,
        convertedContactId: input.contactId,
        convertedDealId: input.dealId,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(
        and(
          eq(leads.id, input.id),
          eq(leads.version, input.expectedVersion),
          isNull(leads.convertedAt),
          isNull(leads.deletedAt),
        ),
      )
      .returning({ id: leads.id });
    assertVersionMatched(rows.length);
  }

  /** Merge (RFC §2.2): soft-delete the merged lead and point it at the survivor. */
  async softDeleteMergedInto(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      mergedIntoLeadId: string;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    const rows = await tx
      .update(leads)
      .set({
        ...softDeletePatch(input.actorPrincipalId),
        mergedIntoLeadId: input.mergedIntoLeadId,
        version: nextVersion(input.expectedVersion),
      })
      .where(this.lockPredicate(input.id, input.expectedVersion))
      .returning({ id: leads.id });
    assertVersionMatched(rows.length);
  }

  private lockPredicate(id: string, expectedVersion: number) {
    return and(eq(leads.id, id), eq(leads.version, expectedVersion), isNull(leads.deletedAt));
  }
}
