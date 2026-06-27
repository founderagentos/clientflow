import { Module } from '@nestjs/common';
import { CrmAccountModule } from '@agentos/crm-account';
import { CrmDealModule } from '@agentos/crm-deal';
import { CrmLeadModule } from '@agentos/crm-lead';
import { AccessFeature } from '../access/access.feature';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { AccountDeletionOrchestrator } from './account-deletion.orchestrator';
import { LeadConversionOrchestrator } from './lead-conversion.orchestrator';
import { BulkImportQueue } from './bulk-import.queue';
import { BulkImportWorker } from './bulk-import.worker';
import { BulkImportOrchestrator } from './bulk-import.orchestrator';
import { AccountsController } from './accounts.controller';
import { ContactsController } from './contacts.controller';
import { DealsController } from './deals.controller';
import { PipelinesController } from './pipelines.controller';
import { LeadsController } from './leads.controller';
import { ImportsController } from './imports.controller';

/**
 * CRM host composition (RFC-002 §3.2) — the only layer permitted to depend on multiple CRM bounded
 * contexts (CLAUDE.md §17). Wires the account, deal, and lead modules (activating the deal module's
 * `DefaultPipelineProvisioner` consumer) and provides the cross-context orchestrators. Phase 3:
 * `AccountDeletionOrchestrator` (open-Deal count for the account delete guard). Phase 4a:
 * `LeadConversionOrchestrator` (atomic Lead → Account/Contact/Deal). Phase 4b: the BullMQ bulk-import
 * stack (`BulkImportOrchestrator` producer + `BulkImportWorker` consumer on a dedicated Redis
 * connection). Phase 6: the CRM HTTP controllers, each guarded by the PDP via `RequirePermissionGuard`
 * (layer 1) — `AccessFeature` supplies the single PDP instance the guard consults.
 */
@Module({
  imports: [CrmAccountModule, CrmDealModule, CrmLeadModule, AccessFeature],
  controllers: [
    AccountsController,
    ContactsController,
    DealsController,
    PipelinesController,
    LeadsController,
    ImportsController,
  ],
  providers: [
    RequirePermissionGuard,
    AccountDeletionOrchestrator,
    LeadConversionOrchestrator,
    BulkImportQueue,
    BulkImportWorker,
    BulkImportOrchestrator,
  ],
  exports: [AccountDeletionOrchestrator, LeadConversionOrchestrator, BulkImportOrchestrator],
})
export class CrmHostModule {}
