import { Injectable } from '@nestjs/common';
import { AccountService, type CrmActor } from '@agentos/crm-account';
import { DealService } from '@agentos/crm-deal';

/**
 * Cross-context account deletion (RFC-002 §2.2/§3.2). The open-Deal delete guard lives in the
 * `account` domain (`AccountService.archive` throws while open deals exist), but the *count* must come
 * from the `deal` module — which the account module may not import (CLAUDE.md §17). The host is the
 * only layer permitted to depend on both, so it resolves the count here and passes it in. The
 * count-then-archive window is acceptable: the RFC frames this as an advisory domain guard, not a
 * hard DB invariant. Phase 6's `DELETE /accounts/{id}` controller calls this orchestrator.
 */
@Injectable()
export class AccountDeletionOrchestrator {
  constructor(
    private readonly accounts: AccountService,
    private readonly deals: DealService,
  ) {}

  async archive(actor: CrmActor, accountId: string, expectedVersion: number): Promise<void> {
    const openDealCount = await this.deals.countOpenDealsForAccount(actor, accountId);
    await this.accounts.archive(actor, { id: accountId, expectedVersion, openDealCount });
  }
}
