import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { OUTBOX } from '@agentos/persistence-kernel';
import { MESSAGE_BUS } from '@agentos/message-bus';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { OutboxWriter } from './application/outbox-writer';
import { InProcessMessageBus } from './infrastructure/in-process-message-bus';
import { RelayWorker } from './application/relay-worker';

/**
 * The `event-backbone` bounded context (CLAUDE.md §1). Phase 2 exposes the transactional outbox
 * writer behind the kernel {@link OUTBOX} port; Phase 5 adds the in-process {@link MESSAGE_BUS}
 * adapter and the {@link RelayWorker} that publishes committed `domain_events` rows to it. Global
 * so every module can emit and subscribe without importing this module (§17) — the same
 * cross-cutting treatment as the database connection. The relay injects the privileged
 * `RELAY_DATABASE` handle (BYPASSRLS), provided by the app's DatabaseModule.
 */
@Global()
@Module({
  providers: [
    OutboxWriter,
    { provide: OUTBOX, useExisting: OutboxWriter },
    InProcessMessageBus,
    { provide: MESSAGE_BUS, useExisting: InProcessMessageBus },
    RelayWorker,
  ],
  exports: [OUTBOX, OutboxWriter, MESSAGE_BUS],
})
export class EventBackboneModule {}

export { OutboxWriter } from './application/outbox-writer';
export { InProcessMessageBus } from './infrastructure/in-process-message-bus';
export { RelayWorker } from './application/relay-worker';
export type { DomainEventEnvelope };
