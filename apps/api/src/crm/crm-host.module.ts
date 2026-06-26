import { Module } from '@nestjs/common';
import { CrmAccountModule } from '@agentos/crm-account';
import { CrmDealModule } from '@agentos/crm-deal';
import { CrmLeadModule } from '@agentos/crm-lead';
import { AccountDeletionOrchestrator } from './account-deletion.orchestrator';
import { LeadConversionOrchestrator } from './lead-conversion.orchestrator';
import { BulkImportQueue } from './bulk-import.queue';
import { BulkImportWorker } from './bulk-import.worker';
import { BulkImportOrchestrator } from './bulk-import.orchestrator';

/**
 * CRM host composition (RFC-002 §3.2) — the only layer permitted to depend on multiple CRM bounded
 * contexts (CLAUDE.md §17). Wires the account, deal, and lead modules (activating the deal module's
 * `DefaultPipelineProvisioner` consumer) and provides the cross-context orchestrators. Phase 3:
 * `AccountDeletionOrchestrator` (open-Deal count for the account delete guard). Phase 4a:
 * `LeadConversionOrchestrator` (atomic Lead → Account/Contact/Deal). Phase 4b: the BullMQ bulk-import
 * stack (`BulkImportOrchestrator` producer + `BulkImportWorker` consumer on a dedicated Redis
 * connection). Phase 6's CRM controllers land here too.
 */
@Module({
  imports: [CrmAccountModule, CrmDealModule, CrmLeadModule],
  providers: [
    AccountDeletionOrchestrator,
    LeadConversionOrchestrator,
    BulkImportQueue,
    BulkImportWorker,
    BulkImportOrchestrator,
  ],
  exports: [AccountDeletionOrchestrator, LeadConversionOrchestrator, BulkImportOrchestrator],
})
export class CrmHostModule {}
