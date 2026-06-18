import { Injectable } from '@nestjs/common';
import { InternalError } from '@agentos/result-errors';
import type { Tx, OutboxPort, OutboxEvent } from '@agentos/persistence-kernel';
import { domainEvents } from '../infrastructure/domain-events.schema';

/**
 * Writes domain events into the `domain_events` outbox **inside the caller's transaction**
 * (CLAUDE.md §3.14) — the same atomic unit as the state change. Implements the kernel
 * {@link OutboxPort} so bounded-context modules emit events without importing this module
 * (§17). The Phase 5 relay publishes pending rows to the broker. Because the insert shares the
 * caller's `tx`, a rolled-back transaction emits no event and a committed one emits exactly one
 * (gate §7.6).
 */
@Injectable()
export class OutboxWriter implements OutboxPort {
  async append(tx: Tx, event: OutboxEvent): Promise<string> {
    if (!event.organizationId || !event.actorPrincipalId || !event.correlationId) {
      // A programming error, not user input: every event must carry tenant + actor + correlation.
      throw new InternalError('Outbox event missing required tenant/actor/correlation context');
    }

    const [row] = await tx
      .insert(domainEvents)
      .values({
        organizationId: event.organizationId,
        workspaceId: event.workspaceId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.type,
        eventVersion: event.eventVersion ?? 1,
        actorPrincipalId: event.actorPrincipalId,
        correlationId: event.correlationId,
        causationId: event.causationId,
        payload: event.payload,
      })
      .returning({ id: domainEvents.id });

    return row!.id;
  }
}
