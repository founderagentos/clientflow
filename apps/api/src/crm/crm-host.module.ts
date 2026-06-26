import { Module } from '@nestjs/common';
import { CrmAccountModule } from '@agentos/crm-account';
import { CrmDealModule } from '@agentos/crm-deal';
import { AccountDeletionOrchestrator } from './account-deletion.orchestrator';

/**
 * CRM host composition (RFC-002 §3.2) — the only layer permitted to depend on multiple CRM bounded
 * contexts (CLAUDE.md §17). Wires the account and deal modules (activating the deal module's
 * `DefaultPipelineProvisioner` consumer) and provides the cross-context orchestrators. Phase 3:
 * `AccountDeletionOrchestrator` (resolves the open-Deal count for the account delete guard). Phase 4's
 * `LeadConversionOrchestrator`/`BulkImportOrchestrator` and Phase 6's CRM controllers land here too.
 */
@Module({
  imports: [CrmAccountModule, CrmDealModule],
  providers: [AccountDeletionOrchestrator],
  exports: [AccountDeletionOrchestrator],
})
export class CrmHostModule {}
