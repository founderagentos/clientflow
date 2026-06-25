import 'reflect-metadata';
import { Module } from '@nestjs/common';

/**
 * The CRM `activity` bounded context (RFC-002 §3.1) — the unified engagement timeline (Activity)
 * and follow-ups (Task). Empty in Phase 0 (scaffold only): schema lands in Phase 1, timeline/task
 * logic in later phases. Distinct from the kernel `audit_log_entries` (the security record):
 * Activity is the *business* record; `is_system=true` rows are append-only. Integrate only via
 * `@agentos/contracts` and domain events.
 */
@Module({})
export class CrmActivityModule {}
