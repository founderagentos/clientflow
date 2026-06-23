import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { AuditLogEntriesRepository } from './infrastructure/audit-log-entries.repository';
import { AuditConsumer } from './application/audit-consumer';
import { AuditQueryService } from './application/audit-query.service';

/**
 * The `audit` bounded context (CLAUDE.md §1, §6 Phase 5). {@link AuditConsumer} subscribes to the
 * global MessageBus and appends every domain event to the append-only `audit_log_entries` trail;
 * {@link AuditQueryService} is the read side the host exposes behind an `audit.read`-guarded route.
 *
 * Injects the global `DATABASE` (app_user pool) and `MESSAGE_BUS` tokens — provided by the app's
 * DatabaseModule and the event-backbone module — so it needs no host-supplied factory wiring.
 * Modules integrate only via `@agentos/contracts` and domain events (§17).
 */
@Module({
  providers: [AuditLogEntriesRepository, AuditConsumer, AuditQueryService],
  exports: [AuditQueryService],
})
export class AuditModule {}

export { AuditQueryService } from './application/audit-query.service';
export type {
  AuditListInput,
  AuditListResult,
  AuditQueryScope,
} from './application/audit-query.service';
export type { AuditLogView } from './infrastructure/audit-log-entries.repository';
export { classify } from './application/audit-projection';
export type { AuditClassification, AuditResult } from './application/audit-projection';
export type { DomainEventEnvelope };
