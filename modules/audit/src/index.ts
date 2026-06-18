import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';

/**
 * The `audit` bounded context (CLAUDE.md §1). Placeholder for Phase 0 — controllers,
 * providers and the internal domain/application/infrastructure layers are added in its
 * phase. Modules integrate only via `@agentos/contracts` and domain events (§17).
 */
@Module({})
export class AuditModule {}

export type { DomainEventEnvelope };
