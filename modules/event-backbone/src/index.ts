import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { OUTBOX } from '@agentos/persistence-kernel';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { OutboxWriter } from './application/outbox-writer';

/**
 * The `event-backbone` bounded context (CLAUDE.md §1). Phase 2 exposes the transactional
 * outbox writer behind the kernel {@link OUTBOX} port; the relay/publisher and MessageBus port
 * arrive in Phase 5. Global so every module can emit events without importing this module
 * (§17) — the same cross-cutting treatment as the database connection.
 */
@Global()
@Module({
  providers: [OutboxWriter, { provide: OUTBOX, useExisting: OutboxWriter }],
  exports: [OUTBOX, OutboxWriter],
})
export class EventBackboneModule {}

export { OutboxWriter } from './application/outbox-writer';
export type { DomainEventEnvelope };
