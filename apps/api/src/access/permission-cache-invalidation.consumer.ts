import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { AccessEventType, TenancyEventType } from '@agentos/contracts';
import { MESSAGE_BUS, type DeliveredEvent, type MessageBus } from '@agentos/message-bus';
import { PERMISSION_CACHE, type PermissionCachePort } from '@agentos/access';

/** The §10-named events all carry the affected principal in their payload. */
const principalPayload = z.object({ principalId: z.string() });

/**
 * Durable, event-driven permission-cache invalidation — the constitution's §3.10 mechanism: on
 * `RoleAssigned` / `RoleRevoked` / `MemberRemoved`, clear the affected principal's cached
 * permission set so a revoked grant stops authorizing within one access-token TTL (gate §7.5).
 *
 * The orchestrators also invalidate directly after commit (the fast path that surfaces errors to
 * the caller); this consumer is the durable backup that fires for *any* emitter of these events,
 * including future non-HTTP paths. It is intentionally best-effort: a cache hiccup must never block
 * event delivery or the audit trail, and the Redis cache already fails safe (an outage degrades the
 * PDP to cache-miss — re-resolving from the database — never to stale grants). Invalidation is an
 * idempotent INCR, so re-delivery is harmless.
 */
@Injectable()
export class PermissionCacheInvalidationConsumer implements OnModuleInit {
  private readonly logger = new Logger(PermissionCacheInvalidationConsumer.name);

  private static readonly TYPES: readonly string[] = [
    AccessEventType.RoleAssigned,
    AccessEventType.RoleRevoked,
    TenancyEventType.MemberRemoved,
  ];

  constructor(
    @Inject(MESSAGE_BUS) private readonly bus: MessageBus,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
  ) {}

  onModuleInit(): void {
    for (const type of PermissionCacheInvalidationConsumer.TYPES) {
      this.bus.subscribe(type, (event) => this.handle(event));
    }
  }

  private async handle(event: DeliveredEvent): Promise<void> {
    const parsed = principalPayload.safeParse(event.payload);
    if (!parsed.success) return;
    try {
      await this.cache.invalidate(parsed.data.principalId, event.organizationId);
    } catch (err) {
      this.logger.warn(
        { err, principalId: parsed.data.principalId, eventType: event.type },
        'event-driven permission-cache invalidation failed (best-effort backup)',
      );
    }
  }
}
