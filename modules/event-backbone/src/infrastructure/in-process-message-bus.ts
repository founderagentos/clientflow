import { Injectable } from '@nestjs/common';
import {
  ALL_EVENTS,
  type DeliveredEvent,
  type EventHandler,
  type MessageBus,
} from '@agentos/message-bus';

/**
 * In-process {@link MessageBus} adapter (CLAUDE.md §2 — in-process dispatcher now, Kafka/Redpanda
 * at Stage 3 behind the same port; RFC §12). Handlers are invoked within `publish`, and the call
 * resolves only once every matching handler has settled successfully; if any handler throws,
 * `publish` rejects. That lets the relay treat a publish failure as "not delivered" and retry the
 * row — at-least-once delivery, the same contract a broker ack would give.
 *
 * Subscriptions are registered at module init (consumers' `OnModuleInit`), before the relay starts
 * polling in `OnApplicationBootstrap` (CLAUDE.md §6 Phase 5 ordering), so no committed event is
 * missed.
 */
@Injectable()
export class InProcessMessageBus implements MessageBus {
  /** event type (or ALL_EVENTS) → handlers. */
  private readonly handlers = new Map<string, EventHandler[]>();

  subscribe(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(eventType, [handler]);
    }
  }

  async publish(event: DeliveredEvent): Promise<void> {
    const handlers = [
      ...(this.handlers.get(event.type) ?? []),
      ...(this.handlers.get(ALL_EVENTS) ?? []),
    ];
    // Sequential, not Promise.all: deterministic ordering and bounded concurrency. A handler that
    // throws aborts the rest and rejects `publish`; the relay keeps the row pending and re-delivers
    // it next tick, so handlers that already ran will run again — hence the idempotency contract.
    for (const handler of handlers) {
      await handler(event);
    }
  }
}
