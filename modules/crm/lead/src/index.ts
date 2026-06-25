import 'reflect-metadata';
import { Module } from '@nestjs/common';

/**
 * The CRM `lead` bounded context (RFC-002 §3.1) — the Lead aggregate, dedup keys, merge, and the
 * conversion source. Empty in Phase 0 (scaffold only): the schema lands in Phase 1, the lifecycle
 * + dedup/merge in Phase 4. Integrate only via `@agentos/contracts` and domain events (§3.3 /
 * CLAUDE.md §17); cross-CRM-module composition happens in `apps/api/src/crm/` host orchestrators.
 */
@Module({})
export class CrmLeadModule {}
