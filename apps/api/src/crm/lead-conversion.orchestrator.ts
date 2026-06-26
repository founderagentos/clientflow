import { Inject, Injectable } from '@nestjs/common';
import { ValidationError, InternalError } from '@agentos/result-errors';
import { DATABASE, withTenantTransaction, type Database } from '@agentos/persistence-kernel';
import { AccountService, AccountContactService, ContactService, type CrmActor } from '@agentos/crm-account';
import { DealService } from '@agentos/crm-deal';
import { LeadService } from '@agentos/crm-lead';

export interface ConvertLeadResult {
  accountId: string;
  contactId: string;
  dealId: string;
  /** True when the lead was already converted — the stored ids are returned, nothing was written. */
  alreadyConverted: boolean;
}

/**
 * Cross-context Lead → Account/Contact/Deal conversion (RFC-002 §2.2/§4.C), the largest atomic
 * operation in CRM Core. One `withTenantTransaction` composes the tx-taking `*Within` writer methods
 * across three modules the lead module may not import directly (CLAUDE.md §17 — only the host may
 * depend on multiple CRM contexts): match-or-create the Account (by normalized domain), match-or-
 * create the Contact (by normalized email), link them primary, create the Deal, then mark the lead
 * converted. All five writes succeed or none do.
 *
 * **One-shot (RFC §6.2):** `lead.convertedAt` is checked first; if already set, the stored ids are
 * returned and nothing else runs — no new entities, no new events. This is the literal gate (a
 * sequential replay after commit); a concurrent simultaneous conversion is still safe (not silently
 * duplicated) because `LeadService.convertWithin`'s repo guard aborts the whole transaction on a
 * losing race, rolling back this orchestrator's freshly-created Account/Contact/Deal with it.
 */
@Injectable()
export class LeadConversionOrchestrator {
  constructor(
    private readonly leads: LeadService,
    private readonly accounts: AccountService,
    private readonly contacts: ContactService,
    private readonly accountContacts: AccountContactService,
    private readonly deals: DealService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async convert(actor: CrmActor, leadId: string): Promise<ConvertLeadResult> {
    return withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      async (tx) => {
        const lead = await this.leads.getWithin(tx, leadId);

        if (lead.convertedAt) {
          if (!lead.convertedAccountId || !lead.convertedContactId || !lead.convertedDealId) {
            throw new InternalError('Lead is marked converted but its produced ids are missing');
          }
          return {
            accountId: lead.convertedAccountId,
            contactId: lead.convertedContactId,
            dealId: lead.convertedDealId,
            alreadyConverted: true,
          };
        }
        this.leads.requireConvertible(lead);

        const accountName = lead.name?.trim() || lead.domain?.trim() || null;
        if (!accountName) {
          throw new ValidationError('Lead has no name or domain to derive an Account name from');
        }

        const { accountId } = await this.accounts.matchOrCreateWithin(tx, actor, {
          name: accountName,
          domain: lead.domain,
        });
        const { contactId } = await this.contacts.matchOrCreateWithin(tx, actor, {
          firstName: lead.name,
          email: lead.email,
        });
        await this.accountContacts.linkWithin(tx, actor, { accountId, contactId, isPrimary: true });
        const deal = await this.deals.createWithin(tx, actor, {
          accountId,
          primaryContactId: contactId,
        });

        await this.leads.convertWithin(tx, actor, {
          leadId,
          expectedVersion: lead.version,
          accountId,
          contactId,
          dealId: deal.id,
        });

        return { accountId, contactId, dealId: deal.id, alreadyConverted: false };
      },
    );
  }
}
