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
  AccountsRepository,
  type AccountRow,
  type AccountKeysetCursor,
} from '../infrastructure/accounts.repository';
import { AccountContactsRepository } from '../infrastructure/account-contacts.repository';
import { assertAccountDeletable } from '../domain/account-deletion';
import { normalizeDomain } from '../domain/normalize';
import type { CrmActor } from './crm-actor';

export interface CreateAccountInput {
  name: string;
  domain?: string | null;
  industry?: string | null;
  sizeBand?: string | null;
  address?: Record<string, unknown>;
  ownerPrincipalId?: string | null;
  customFields?: Record<string, unknown>;
}

export interface UpdateAccountFields {
  name?: string;
  domain?: string | null;
  industry?: string | null;
  sizeBand?: string | null;
  address?: Record<string, unknown>;
  ownerPrincipalId?: string | null;
  customFields?: Record<string, unknown>;
}

export interface ListAccountsInput {
  limit: number;
  cursor?: AccountKeysetCursor;
}

export interface ArchiveAccountInput {
  id: string;
  expectedVersion: number;
  /** Resolved by the caller (Phase 3 host orchestrator via the deal contract). 0 in Phase 2. */
  openDealCount: number;
}

/**
 * Account lifecycle within the active org+workspace (RFC-002 §2.2). Every operation runs in a tenant
 * transaction and emits its PastTense event to the outbox in the same unit of work (§3.14).
 * Deletion is soft and guarded: `assertAccountDeletable` blocks it while open Deals exist, and the
 * `account_contacts` links cascade-soft-delete with the account. Cross-tenant ids return no row
 * under RLS → 404 (§3.8).
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly links: AccountContactsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async get(actor: CrmActor, id: string): Promise<AccountRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const row = await this.accounts.findById(tx, id);
      if (!row) {
        throw new NotFoundError('Account not found');
      }
      return row;
    });
  }

  async list(actor: CrmActor, input: ListAccountsInput): Promise<AccountRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.accounts.listByWorkspace(tx, input.limit, input.cursor),
    );
  }

  async create(actor: CrmActor, input: CreateAccountInput): Promise<AccountRow> {
    const accountId = newId();
    const domain = normalizeDomain(input.domain);
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      await this.accounts.insert(tx, {
        id: accountId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        name: input.name,
        domain,
        industry: input.industry ?? null,
        sizeBand: input.sizeBand ?? null,
        address: input.address ?? {},
        ownerPrincipalId: input.ownerPrincipalId ?? null,
        customFields: input.customFields ?? {},
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, accountId),
        type: CrmEventType.AccountCreated,
        payload: { accountId, name: input.name, domain },
      });
      return this.requireById(tx, accountId);
    });
  }

  async update(
    actor: CrmActor,
    id: string,
    expectedVersion: number,
    fields: UpdateAccountFields,
  ): Promise<AccountRow> {
    // Normalize the domain signal when it is part of this update.
    const normalized: UpdateAccountFields =
      'domain' in fields ? { ...fields, domain: normalizeDomain(fields.domain) } : fields;
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.accounts.findById(tx, id);
      if (!existing) {
        throw new NotFoundError('Account not found');
      }
      const changed = await this.accounts.update(tx, {
        id,
        expectedVersion,
        actorPrincipalId: actor.principalId,
        fields: normalized,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, id),
        type: CrmEventType.AccountUpdated,
        payload: { accountId: id, changed },
      });
      return this.requireById(tx, id);
    });
  }

  async archive(actor: CrmActor, input: ArchiveAccountInput): Promise<void> {
    assertAccountDeletable(input.openDealCount);
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.accounts.findById(tx, input.id);
      if (!existing) {
        throw new NotFoundError('Account not found');
      }
      await this.accounts.archive(tx, {
        id: input.id,
        expectedVersion: input.expectedVersion,
        actorPrincipalId: actor.principalId,
      });
      // Cascade: the account's contact links follow it out of active listings.
      await this.links.softDeleteForAccount(tx, input.id, actor.principalId);
      await this.outbox.append(tx, {
        ...this.eventBase(actor, input.id),
        type: CrmEventType.AccountDeleted,
        payload: { accountId: input.id },
      });
    });
  }

  private async requireById(tx: Tx, id: string): Promise<AccountRow> {
    const row = await this.accounts.findById(tx, id);
    if (!row) {
      throw new NotFoundError('Account not found');
    }
    return row;
  }

  private eventBase(actor: CrmActor, accountId: string) {
    return {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      actorPrincipalId: actor.principalId,
      correlationId: actor.correlationId,
      causationId: null,
      aggregateType: CrmAggregateType.Account,
      aggregateId: accountId,
    };
  }

  private scope(actor: CrmActor): { organizationId: string; workspaceId: string } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
