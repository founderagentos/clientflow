import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
  type Tx,
} from '@agentos/persistence-kernel';
import { newId } from '@agentos/identifier';
import { LeadAggregateType, LeadEventType, LeadStatus } from '@agentos/contracts';
import {
  LeadsRepository,
  type LeadRow,
  type LeadKeysetCursor,
} from '../infrastructure/leads.repository';
import { normalizeDomain, normalizeEmail, normalizePhoneE164 } from '../domain/lead-normalization';
import { assertConvertible, assertStatusChange } from '../domain/lead-status';
import type { LeadActor } from './lead-actor';

export interface CreateLeadInput {
  status?: LeadStatus;
  source?: string | null;
  name?: string | null;
  email?: string | null;
  /** Raw phone number; normalized to E.164 and stored — the raw form is not retained (no column). */
  phone?: string | null;
  domain?: string | null;
  ownerPrincipalId?: string | null;
  customFields?: Record<string, unknown>;
}

export interface UpdateLeadFields {
  source?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
  score?: number | null;
  customFields?: Record<string, unknown>;
}

export interface ListLeadsInput {
  limit: number;
  cursor?: LeadKeysetCursor;
}

export interface ConvertWithinInput {
  leadId: string;
  expectedVersion: number;
  accountId: string;
  contactId: string;
  dealId: string;
}

/**
 * Lead lifecycle within the active org+workspace (RFC-002 §2.2/§4.C) — top-of-funnel, disposable,
 * dedup-prone, **convertible exactly once**. Every public write runs in its own tenant transaction
 * and emits its event. `getWithin`/`convertWithin` are tx-taking (no transaction of their own) for
 * the `LeadConversionOrchestrator`, which composes them inside its single cross-module transaction.
 */
@Injectable()
export class LeadService {
  constructor(
    private readonly leads: LeadsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async get(actor: LeadActor, id: string): Promise<LeadRow> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) => this.requireLead(tx, id));
  }

  async list(actor: LeadActor, input: ListLeadsInput): Promise<LeadRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.leads.listByWorkspace(tx, input.limit, input.cursor),
    );
  }

  async create(actor: LeadActor, input: CreateLeadInput): Promise<LeadRow> {
    const leadId = newId();
    const status = input.status ?? LeadStatus.New;
    const emailNormalized = normalizeEmail(input.email);
    const phoneE164 = normalizePhoneE164(input.phone);
    const domain = normalizeDomain(input.domain);
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      await this.leads.insert(tx, {
        id: leadId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        status,
        source: input.source ?? null,
        name: input.name ?? null,
        email: input.email ?? null,
        emailNormalized,
        phoneE164,
        domain,
        ownerPrincipalId: input.ownerPrincipalId ?? null,
        customFields: input.customFields ?? {},
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, leadId),
        type: LeadEventType.LeadCreated,
        payload: { leadId, status },
      });
      return this.requireLead(tx, leadId);
    });
  }

  async update(
    actor: LeadActor,
    id: string,
    expectedVersion: number,
    fields: UpdateLeadFields,
  ): Promise<LeadRow> {
    // `phone` (raw, public input) has no matching column — only its normalized form (`phoneE164`)
    // is persisted, so repoFields is built explicitly rather than spreading `fields` (which would
    // carry a bogus `phone` key the repo doesn't recognize).
    const repoFields = {
      source: fields.source,
      name: fields.name,
      score: fields.score,
      customFields: fields.customFields,
      ...(fields.email !== undefined
        ? { email: fields.email, emailNormalized: normalizeEmail(fields.email) }
        : {}),
      ...(fields.phone !== undefined ? { phoneE164: normalizePhoneE164(fields.phone) } : {}),
      ...(fields.domain !== undefined ? { domain: normalizeDomain(fields.domain) } : {}),
    };
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      await this.requireLead(tx, id);
      const changed = await this.leads.update(tx, {
        id,
        expectedVersion,
        actorPrincipalId: actor.principalId,
        fields: repoFields,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: LeadEventType.LeadUpdated,
        payload: { leadId: id, changed },
      });
      return this.requireLead(tx, id);
    });
  }

  async assign(
    actor: LeadActor,
    id: string,
    expectedVersion: number,
    ownerPrincipalId: string | null,
  ): Promise<LeadRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const lead = await this.requireLead(tx, id);
      await this.leads.assign(tx, {
        id,
        expectedVersion,
        ownerPrincipalId,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: LeadEventType.LeadAssigned,
        payload: { leadId: id, ownerPrincipalId, previousOwnerPrincipalId: lead.ownerPrincipalId },
      });
      return this.requireLead(tx, id);
    });
  }

  async changeStatus(
    actor: LeadActor,
    id: string,
    expectedVersion: number,
    toStatus: LeadStatus,
  ): Promise<LeadRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.requireLead(tx, id);
      assertStatusChange(existing.status as LeadStatus, toStatus, existing.convertedAt);
      await this.leads.changeStatus(tx, {
        id,
        expectedVersion,
        status: toStatus,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: LeadEventType.LeadStatusChanged,
        payload: { leadId: id, fromStatus: existing.status, toStatus },
      });
      return this.requireLead(tx, id);
    });
  }

  /**
   * Soft-deletes `mergedId` and points it at `survivorId` (RFC §2.2). Repointing Activities/Tasks to
   * the survivor is deferred to the activity module (not built yet — leads have no activities until
   * then).
   */
  async merge(
    actor: LeadActor,
    survivorId: string,
    mergedId: string,
    expectedVersion: number,
  ): Promise<void> {
    if (survivorId === mergedId) {
      throw new ValidationError('Cannot merge a lead into itself');
    }
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      await this.requireLead(tx, survivorId);
      await this.requireLead(tx, mergedId);
      await this.leads.softDeleteMergedInto(tx, {
        id: mergedId,
        expectedVersion,
        mergedIntoLeadId: survivorId,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, mergedId),
        type: LeadEventType.LeadsMerged,
        payload: { survivorId, mergedId },
      });
    });
  }

  /** Tx-taking read for the `LeadConversionOrchestrator` — no transaction of its own. */
  async getWithin(tx: Tx, id: string): Promise<LeadRow> {
    return this.requireLead(tx, id);
  }

  /**
   * Convertibility guard, exposed for the orchestrator to check before doing any conversion work
   * (so an unqualified/already-converted lead fails fast, before creating Account/Contact/Deal).
   */
  requireConvertible(lead: LeadRow): void {
    assertConvertible(lead.status as LeadStatus, lead.convertedAt);
  }

  /**
   * Write-once conversion pointers + `LeadConverted` (RFC §2.2/§6.2) — tx-taking, called by the
   * `LeadConversionOrchestrator` inside its single cross-module transaction. The repo's `WHERE
   * converted_at IS NULL` guard makes this safe even under a concurrent race (see repo doc).
   */
  async convertWithin(tx: Tx, actor: LeadActor, input: ConvertWithinInput): Promise<void> {
    await this.leads.markConverted(tx, {
      id: input.leadId,
      expectedVersion: input.expectedVersion,
      accountId: input.accountId,
      contactId: input.contactId,
      dealId: input.dealId,
      actorPrincipalId: actor.principalId,
    });
    await this.outbox.append(tx, {
      ...this.eventBase(actor, input.leadId),
      type: LeadEventType.LeadConverted,
      payload: {
        leadId: input.leadId,
        accountId: input.accountId,
        contactId: input.contactId,
        dealId: input.dealId,
      },
    });
  }

  private async requireLead(tx: Tx, id: string): Promise<LeadRow> {
    const row = await this.leads.findById(tx, id);
    if (!row) {
      throw new NotFoundError('Lead not found');
    }
    return row;
  }

  private eventBase(actor: LeadActor, leadId: string) {
    return {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      actorPrincipalId: actor.principalId,
      correlationId: actor.correlationId,
      causationId: null,
      aggregateType: LeadAggregateType.Lead,
      aggregateId: leadId,
    };
  }

  private scope(actor: LeadActor): { organizationId: string; workspaceId: string } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
