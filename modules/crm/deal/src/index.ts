import 'reflect-metadata';
import { Module } from '@nestjs/common';

/**
 * The CRM `deal` bounded context (RFC-002 §3.1) — Pipeline, Stage, Deal, and the append-only
 * `deal_stage_history` (the sales process). Empty in Phase 0 (scaffold only): schema lands in
 * Phase 1, guarded stage transitions + board counter in Phase 3. The word is **Deal** — never
 * "opportunity"/"job" (§2.1). Integrate only via `@agentos/contracts` and domain events.
 */
@Module({})
export class CrmDealModule {}
