import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DATABASE, withTenantTransaction, type Database } from '@agentos/persistence-kernel';
import {
  ALL_EVENTS,
  MESSAGE_BUS,
  type DeliveredEvent,
  type MessageBus,
} from '@agentos/message-bus';
import { AuditLogEntriesRepository } from '../infrastructure/audit-log-entries.repository';
import { classify } from './audit-projection';

/**
 * Projects every committed domain event into the append-only audit trail (CLAUDE.md §6 Phase 5).
 * Subscribes to all event types at module init — before the relay starts polling
 * (`OnApplicationBootstrap`), so no committed event is missed.
 *
 * Each entry is written under the **event's own tenant context** via `withTenantTransaction`, so
 * the append-only INSERT satisfies RLS as `app_user` (the consumer runs outside any HTTP request,
 * so there is no ambient tenant context to inherit). The actor recorded is the event's
 * `actor_principal_id` — a human or a service account, identically (gate §7.3). The write is
 * idempotent on `source_event_id`, so at-least-once re-delivery never double-records.
 */
@Injectable()
export class AuditConsumer implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MESSAGE_BUS) private readonly bus: MessageBus,
    private readonly repository: AuditLogEntriesRepository,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(ALL_EVENTS, (event) => this.handle(event));
  }

  async handle(event: DeliveredEvent): Promise<void> {
    const { action, resourceType, result } = classify(event);
    await withTenantTransaction(
      this.db,
      { organizationId: event.organizationId, workspaceId: event.workspaceId },
      (tx) =>
        this.repository.append(tx, {
          organizationId: event.organizationId,
          workspaceId: event.workspaceId,
          actorPrincipalId: event.actorPrincipalId,
          action,
          resourceType,
          resourceId: event.aggregateId,
          result,
          // ip / user-agent are HTTP-edge facts not carried by domain events — null here. The
          // columns remain for a future edge-sourced audit path.
          ip: null,
          userAgent: null,
          correlationId: event.correlationId,
          sourceEventId: event.id,
          metadata: { eventType: event.type, eventVersion: event.version, payload: event.payload },
        }),
    );
  }
}
