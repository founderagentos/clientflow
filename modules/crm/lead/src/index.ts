import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { LeadsRepository } from './infrastructure/leads.repository';
import { ImportJobsRepository } from './infrastructure/import-jobs.repository';
import { LeadService } from './application/lead.service';
import { LeadImportService } from './application/lead-import.service';

/**
 * The CRM `lead` bounded context (RFC-002 §3.1) — the Lead aggregate: lifecycle, dedup keys, merge,
 * and the conversion source. Phase 4a ships CRUD (soft delete + optimistic lock), the convertibility
 * guard, merge, and the tx-taking `getWithin`/`convertWithin` the host
 * `LeadConversionOrchestrator` composes into one atomic cross-module transaction. Every write emits
 * its outbox event. Integrate only via `@agentos/contracts` and domain events (CLAUDE.md §17);
 * cross-CRM-module composition happens in `apps/api/src/crm/` host orchestrators.
 */
@Module({
  providers: [LeadsRepository, ImportJobsRepository, LeadService, LeadImportService],
  exports: [LeadService, LeadImportService],
})
export class CrmLeadModule {}

export { LeadService } from './application/lead.service';
export { LeadImportService } from './application/lead-import.service';
export { LeadsRepository, type LeadRow } from './infrastructure/leads.repository';
export type { ImportJobRow } from './infrastructure/import-jobs.repository';
export type { LeadActor } from './application/lead-actor';
export type {
  CreateLeadInput,
  UpdateLeadFields,
  ListLeadsInput,
  ConvertWithinInput,
} from './application/lead.service';
export type {
  ImportRow,
  ChunkCounts,
  FinalCounts,
} from './application/lead-import.service';
export {
  normalizeDomain,
  normalizeEmail,
  normalizePhoneE164,
} from './domain/lead-normalization';
