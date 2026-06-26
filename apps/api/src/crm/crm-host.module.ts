import { Module } from '@nestjs/common';
import { CrmAccountModule } from '@agentos/crm-account';
import { CrmDealModule } from '@agentos/crm-deal';
import { CrmLeadModule } from '@agentos/crm-lead';
import { AccountDeletionOrchestrator } from './account-deletion.orchestrator';
import { LeadConversionOrchestrator } from './lead-conversion.orchestrator';

/**
 * CRM host composition (RFC-002 §3.2) — the only layer permitted to depend on multiple CRM bounded
 * contexts (CLAUDE.md §17). Wires the account, deal, and lead modules (activating the deal module's
 * `DefaultPipelineProvisioner` consumer) and provides the cross-context orchestrators. Phase 3:
 * `AccountDeletionOrchestrator` (resolves the open-Deal count for the account delete guard). Phase 4a:
 * `LeadConversionOrchestrator` (atomic Lead → Account/Contact/Deal). Phase 4b's
 * `BulkImportOrchestrator` and Phase 6's CRM controllers land here too.
 */
@Module({
  imports: [CrmAccountModule, CrmDealModule, CrmLeadModule],
  providers: [AccountDeletionOrchestrator, LeadConversionOrchestrator],
  exports: [AccountDeletionOrchestrator, LeadConversionOrchestrator],
})
export class CrmHostModule {}
