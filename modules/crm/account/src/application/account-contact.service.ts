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
import { AUTHORIZATION, authorizeCommand, type AuthorizationPort } from '@agentos/authorization';
import { CrmAggregateType, CrmEventType } from '@agentos/contracts';
import { AccountsRepository } from '../infrastructure/accounts.repository';
import { ContactsRepository, type ContactRow } from '../infrastructure/contacts.repository';
import { AccountContactsRepository } from '../infrastructure/account-contacts.repository';
import type { CrmActor } from './crm-actor';

export interface LinkContactInput {
  accountId: string;
  contactId: string;
  relationshipRole?: string | null;
  isPrimary?: boolean;
}

export interface LinkWithinResult {
  linked: boolean;
}

/**
 * Manages the Account↔Contact relationship (RFC-002 §2.2). Each operation validates both ends exist
 * in-tenant (cross-tenant ids return no row under RLS → 404, §3.8), mutates `account_contacts`, and
 * emits exactly one event. The ≤1-primary-per-account invariant is held by demoting the current
 * primary in the same transaction before promoting the new one.
 */
@Injectable()
export class AccountContactService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly contacts: ContactsRepository,
    private readonly links: AccountContactsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(AUTHORIZATION) private readonly authz: AuthorizationPort,
  ) {}

  async link(actor: CrmActor, input: LinkContactInput): Promise<void> {
    await authorizeCommand(this.authz, actor, 'account.update');
    const relationshipRole = input.relationshipRole ?? null;
    const isPrimary = input.isPrimary ?? false;
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      await this.requireAccount(tx, input.accountId);
      await this.requireContact(tx, input.contactId);
      if (isPrimary) {
        const current = await this.links.findPrimary(tx, input.accountId);
        if (current && current.contactId !== input.contactId) {
          await this.links.setPrimaryFlag(tx, {
            accountId: input.accountId,
            contactId: current.contactId,
            isPrimary: false,
            actorPrincipalId: actor.principalId,
          });
        }
      }
      await this.links.link(tx, {
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        accountId: input.accountId,
        contactId: input.contactId,
        relationshipRole,
        isPrimary,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, input.accountId),
        type: CrmEventType.AccountContactLinked,
        payload: { accountId: input.accountId, contactId: input.contactId, relationshipRole, isPrimary },
      });
    });
  }

  async setPrimary(actor: CrmActor, accountId: string, contactId: string): Promise<void> {
    await authorizeCommand(this.authz, actor, 'account.update');
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const link = await this.links.findLink(tx, accountId, contactId);
      if (!link) {
        throw new NotFoundError('Contact is not linked to this account');
      }
      const current = await this.links.findPrimary(tx, accountId);
      const previousPrimaryContactId = current?.contactId ?? null;
      if (current && current.contactId !== contactId) {
        await this.links.setPrimaryFlag(tx, {
          accountId,
          contactId: current.contactId,
          isPrimary: false,
          actorPrincipalId: actor.principalId,
        });
      }
      await this.links.setPrimaryFlag(tx, {
        accountId,
        contactId,
        isPrimary: true,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, accountId),
        type: CrmEventType.AccountPrimaryContactChanged,
        payload: { accountId, contactId, previousPrimaryContactId },
      });
    });
  }

  async unlink(actor: CrmActor, accountId: string, contactId: string): Promise<void> {
    await authorizeCommand(this.authz, actor, 'account.update');
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const link = await this.links.findLink(tx, accountId, contactId);
      if (!link) {
        throw new NotFoundError('Contact is not linked to this account');
      }
      await this.links.unlink(tx, { accountId, contactId, actorPrincipalId: actor.principalId });
      await this.outbox.append(tx, {
        ...this.eventBase(actor, accountId),
        type: CrmEventType.AccountContactUnlinked,
        payload: { accountId, contactId },
      });
    });
  }

  /**
   * Tx-taking link (RFC §4.C), composed by the `LeadConversionOrchestrator` inside its single
   * cross-module transaction. Unlike the public `link()` (which 409s on a duplicate), this is a
   * **no-op** if the pair is already linked — the orchestrator's dedup match can resolve the same
   * Account+Contact pair on a replay/second lead, and re-linking should never be an error. Skips the
   * account/contact existence checks `link()` does, since the caller just created/matched both
   * within this same transaction.
   */
  async linkWithin(tx: Tx, actor: CrmActor, input: LinkContactInput): Promise<LinkWithinResult> {
    const existing = await this.links.findLink(tx, input.accountId, input.contactId);
    if (existing) {
      return { linked: false };
    }
    const relationshipRole = input.relationshipRole ?? null;
    const isPrimary = input.isPrimary ?? false;
    if (isPrimary) {
      const current = await this.links.findPrimary(tx, input.accountId);
      if (current && current.contactId !== input.contactId) {
        await this.links.setPrimaryFlag(tx, {
          accountId: input.accountId,
          contactId: current.contactId,
          isPrimary: false,
          actorPrincipalId: actor.principalId,
        });
      }
    }
    await this.links.link(tx, {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      accountId: input.accountId,
      contactId: input.contactId,
      relationshipRole,
      isPrimary,
      actorPrincipalId: actor.principalId,
    });
    await this.outbox.append(tx, {
      ...this.eventBase(actor, input.accountId),
      type: CrmEventType.AccountContactLinked,
      payload: { accountId: input.accountId, contactId: input.contactId, relationshipRole, isPrimary },
    });
    return { linked: true };
  }

  /** The active contacts linked to an account (the read behind `GET /accounts/{id}/contacts`). */
  async listContactsForAccount(actor: CrmActor, accountId: string): Promise<ContactRow[]> {
    await authorizeCommand(this.authz, actor, 'account.read');
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      await this.requireAccount(tx, accountId);
      const linkRows = await this.links.listByAccount(tx, accountId);
      const result: ContactRow[] = [];
      for (const link of linkRows) {
        const contact = await this.contacts.findById(tx, link.contactId);
        if (contact) {
          result.push(contact);
        }
      }
      return result;
    });
  }

  private async requireAccount(tx: Tx, id: string): Promise<void> {
    if (!(await this.accounts.findById(tx, id))) {
      throw new NotFoundError('Account not found');
    }
  }

  private async requireContact(tx: Tx, id: string): Promise<void> {
    if (!(await this.contacts.findById(tx, id))) {
      throw new NotFoundError('Contact not found');
    }
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
