import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { AccountsRepository } from './infrastructure/accounts.repository';
import { ContactsRepository } from './infrastructure/contacts.repository';
import { AccountContactsRepository } from './infrastructure/account-contacts.repository';
import { AccountService } from './application/account.service';
import { ContactService } from './application/contact.service';
import { AccountContactService } from './application/account-contact.service';

/**
 * The CRM `account` bounded context (RFC-002 §3.1) — the relational core of the book of business:
 * Account + Contact + the `account_contacts` relationship. Phase 2 ships CRUD (soft delete +
 * optimistic lock), the ≤1-primary invariant, the open-Deal delete guard, and the GDPR/DPDP erasure
 * path; every write emits its outbox event. HTTP controllers + PDP gating arrive in Phases 5–6.
 * **Account ≠ Organization** and **Contact ≠ User/Principal** (§2.1). Integrate only via
 * `@agentos/contracts` and domain events (§17).
 */
@Module({
  providers: [
    AccountsRepository,
    ContactsRepository,
    AccountContactsRepository,
    AccountService,
    ContactService,
    AccountContactService,
  ],
  exports: [AccountService, ContactService, AccountContactService],
})
export class CrmAccountModule {}

export { AccountService } from './application/account.service';
export { ContactService } from './application/contact.service';
export { AccountContactService } from './application/account-contact.service';
export { AccountsRepository, type AccountRow } from './infrastructure/accounts.repository';
export { ContactsRepository, type ContactRow } from './infrastructure/contacts.repository';
export {
  AccountContactsRepository,
  type AccountContactRow,
} from './infrastructure/account-contacts.repository';
export type { CrmActor } from './application/crm-actor';
export type {
  CreateAccountInput,
  UpdateAccountFields,
  ArchiveAccountInput,
  ListAccountsInput,
  MatchOrCreateAccountInput,
  MatchOrCreateAccountResult,
} from './application/account.service';
export type {
  CreateContactInput,
  UpdateContactFields,
  ListContactsInput,
  MatchOrCreateContactInput,
  MatchOrCreateContactResult,
} from './application/contact.service';
export type { LinkContactInput, LinkWithinResult } from './application/account-contact.service';
