/**
 * A domain event delivered to in-process subscribers (and, at Stage 3, the broker). Structurally
 * mirrors the `@agentos/contracts` domain-event envelope, but is defined here locally on purpose:
 * a platform package may not depend on the contracts package (Nx boundary — `scope:platform`
 * depends only on `scope:platform`, CLAUDE.md §17/§18). The relay builds one of these per
 * `domain_events` row.
 */
export interface DeliveredEvent {
  /** UUIDv7 of the originating `domain_events` row — the idempotency key for consumers. */
  id: string;
  /** PastTense event type, e.g. 'UserRegistered' (CLAUDE.md §3.15). */
  type: string;
  /** Payload schema version. */
  version: number;
  aggregateType: string;
  aggregateId: string;
  /** Mandatory tenant (CLAUDE.md §3.15). */
  organizationId: string;
  /** null = org-scoped event. */
  workspaceId: string | null;
  /** Mandatory actor — human or service account (CLAUDE.md §3.15). */
  actorPrincipalId: string;
  correlationId: string;
  causationId: string | null;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

/**
 * A subscriber callback. **Must be idempotent**: delivery is at-least-once (the relay re-delivers
 * a row whose publish did not fully succeed), so a handler may see the same `DeliveredEvent.id`
 * more than once (CLAUDE.md §3.14).
 */
export type EventHandler = (event: DeliveredEvent) => Promise<void>;

/** Subscribe to every event type, regardless of `DeliveredEvent.type`. */
export const ALL_EVENTS = '*';

/**
 * The message-bus port (CLAUDE.md §2 — "Outbox → broker abstraction"). The event-backbone relay
 * publishes; bounded-context modules subscribe. An in-process adapter backs it now; swapping to
 * Kafka/Redpanda at Stage 3 is a single adapter change (RFC §12) — producers and consumers do not
 * change.
 *
 * `publish` resolves only after **every** matching handler has succeeded ("durably accepted for
 * delivery"). That contract is what lets the relay treat a publish failure as "not delivered" and
 * retry the row, giving at-least-once semantics in-process the same way a broker ack would.
 */
export interface MessageBus {
  publish(event: DeliveredEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): void;
}

/** DI token for {@link MessageBus}; provided (globally) by the event-backbone module. */
export const MESSAGE_BUS = Symbol('agentos.message-bus');
