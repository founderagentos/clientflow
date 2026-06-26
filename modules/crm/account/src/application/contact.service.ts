import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
  type Tx,
} from '@agentos/persistence-kernel';
import { newId } from '@agentos/identifier';
import { CrmAggregateType, CrmEventType } from '@agentos/contracts';
import {
  ContactsRepository,
  type ContactRow,
  type ContactKeysetCursor,
} from '../infrastructure/contacts.repository';
import { AccountContactsRepository } from '../infrastructure/account-contacts.repository';
import { normalizeEmail } from '../domain/normalize';
import type { CrmActor } from './crm-actor';

export interface CreateContactInput {
  firstName?: string | null;
  lastName?: string | null;
  /** `emails[0]` is treated as the primary and drives `primary_email_normalized`. */
  emails?: string[];
  phones?: string[];
  title?: string | null;
  ownerPrincipalId?: string | null;
  customFields?: Record<string, unknown>;
}

export interface UpdateContactFields {
  firstName?: string | null;
  lastName?: string | null;
  emails?: string[];
  phones?: string[];
  title?: string | null;
  ownerPrincipalId?: string | null;
  customFields?: Record<string, unknown>;
}

export interface ListContactsInput {
  limit: number;
  cursor?: ContactKeysetCursor;
}

/**
 * Contact lifecycle within the active org+workspace (RFC-002 §2.2). Holds PII. Every write emits its
 * event atomically. `primary_email_normalized` (a dedup signal, §6.2) is derived from `emails[0]` on
 * create/update. `erase` (§8.4) purges PII and leaves a referentially-valid tombstone — distinct
 * from `archive` (soft delete). Linking to accounts is a separate explicit operation
 * (`AccountContactService`), so each method here maps to exactly one write + one event.
 */
@Injectable()
export class ContactService {
  constructor(
    private readonly contacts: ContactsRepository,
    private readonly links: AccountContactsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async get(actor: CrmActor, id: string): Promise<ContactRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const row = await this.contacts.findById(tx, id);
      if (!row) {
        throw new NotFoundError('Contact not found');
      }
      return row;
    });
  }

  async list(actor: CrmActor, input: ListContactsInput): Promise<ContactRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.contacts.listByWorkspace(tx, input.limit, input.cursor),
    );
  }

  async create(actor: CrmActor, input: CreateContactInput): Promise<ContactRow> {
    const contactId = newId();
    const emails = input.emails ?? [];
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      await this.contacts.insert(tx, {
        id: contactId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        emails,
        phones: input.phones ?? [],
        primaryEmailNormalized: normalizeEmail(emails[0]),
        title: input.title ?? null,
        ownerPrincipalId: input.ownerPrincipalId ?? null,
        customFields: input.customFields ?? {},
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, contactId),
        type: CrmEventType.ContactCreated,
        payload: { contactId, accountId: null },
      });
      return this.requireById(tx, contactId);
    });
  }

  async update(
    actor: CrmActor,
    id: string,
    expectedVersion: number,
    fields: UpdateContactFields,
  ): Promise<ContactRow> {
    // Recompute the normalized dedup signal whenever the email set changes.
    const repoFields =
      fields.emails !== undefined
        ? { ...fields, primaryEmailNormalized: normalizeEmail(fields.emails[0]) }
        : fields;
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.contacts.findById(tx, id);
      if (!existing) {
        throw new NotFoundError('Contact not found');
      }
      const changed = await this.contacts.update(tx, {
        id,
        expectedVersion,
        actorPrincipalId: actor.principalId,
        fields: repoFields,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: CrmEventType.ContactUpdated,
        payload: { contactId: id, changed },
      });
      return this.requireById(tx, id);
    });
  }

  async archive(actor: CrmActor, id: string, expectedVersion: number): Promise<void> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.contacts.findById(tx, id);
      if (!existing) {
        throw new NotFoundError('Contact not found');
      }
      await this.contacts.archive(tx, { id, expectedVersion, actorPrincipalId: actor.principalId });
      await this.links.softDeleteForContact(tx, id, actor.principalId);
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: CrmEventType.ContactDeleted,
        payload: { contactId: id },
      });
    });
  }

  /**
   * GDPR/DPDP erasure (§8.4) — purges PII, sets `erased_at`, leaves the row + its `account_contacts`
   * links intact (a tenant-safe tombstone). Emits `ContactErased`. Sensitive op — audited; PDP gating
   * to elevated roles is wired in Phase 5.
   */
  async erase(actor: CrmActor, id: string, expectedVersion: number): Promise<void> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.contacts.findById(tx, id);
      if (!existing) {
        throw new NotFoundError('Contact not found');
      }
      await this.contacts.erase(tx, { id, expectedVersion, actorPrincipalId: actor.principalId });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: CrmEventType.ContactErased,
        payload: { contactId: id },
      });
    });
  }

  private async requireById(tx: Tx, id: string): Promise<ContactRow> {
    const row = await this.contacts.findById(tx, id);
    if (!row) {
      throw new NotFoundError('Contact not found');
    }
    return row;
  }

  private eventBase(actor: CrmActor, contactId: string) {
    return {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      actorPrincipalId: actor.principalId,
      correlationId: actor.correlationId,
      causationId: null,
      aggregateType: CrmAggregateType.Contact,
      aggregateId: contactId,
    };
  }

  private scope(actor: CrmActor): { organizationId: string; workspaceId: string } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
