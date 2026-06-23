import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { RELAY_DATABASE, type Database } from '@agentos/persistence-kernel';
import { MESSAGE_BUS, type DeliveredEvent, type MessageBus } from '@agentos/message-bus';
import { domainEvents } from '../infrastructure/domain-events.schema';

/** Rows claimed per tick. Keeps each transaction (and its row locks) short. */
const BATCH_SIZE = 100;
/** Idle poll interval when the last tick drained the outbox. */
const IDLE_DELAY_MS = 500;
/** Give up re-delivering after this many failures: row goes `failed` for operator follow-up. */
const MAX_ATTEMPTS = 10;

/**
 * The transactional-outbox relay (CLAUDE.md §3.14, §6 Phase 5). It polls `domain_events` for rows
 * the relay has not yet delivered (`published_at IS NULL`), publishes each to the {@link MessageBus},
 * and marks it published — all inside one transaction so a crash mid-batch simply leaves the rows
 * pending for the next tick (no lost or phantom events).
 *
 * Runs on the privileged {@link RELAY_DATABASE} connection (`event_relay`, BYPASSRLS): the relay is
 * cross-tenant infrastructure and must see every organization's events, which the RLS-bound
 * `app_user` pool cannot. Batches are claimed with `FOR UPDATE SKIP LOCKED`, so multiple API
 * instances can run the relay concurrently without double-publishing — leaderless, no coordinator.
 *
 * Because `publish` resolves only after every consumer succeeds, a failed consumer leaves the row
 * pending (attempt counter bumped) and it is re-delivered next tick; consumers are idempotent, so
 * re-delivery is safe (at-least-once).
 */
@Injectable()
export class RelayWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RelayWorker.name);
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  /** The in-flight tick, awaited on shutdown so we never sever a transaction mid-publish. */
  private draining: Promise<unknown> | null = null;

  constructor(
    @Inject(RELAY_DATABASE) private readonly db: Database,
    @Inject(MESSAGE_BUS) private readonly bus: MessageBus,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.scheduleNext(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.draining) {
      await this.draining.catch(() => undefined);
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.draining = this.tick()
        .then((processed) => {
          // Drain greedily while batches come back full; relax to polling once caught up.
          this.scheduleNext(processed === BATCH_SIZE ? 0 : IDLE_DELAY_MS);
        })
        .catch((err: unknown) => {
          this.logger.error({ err }, 'relay tick failed; backing off');
          this.scheduleNext(IDLE_DELAY_MS);
        });
    }, delayMs);
  }

  /**
   * Claim and publish one batch. Returns the number of rows claimed (a full batch means more may
   * be waiting). Public so tests can drive the relay deterministically without the timer loop.
   */
  async tick(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(domainEvents)
        .where(isNull(domainEvents.publishedAt))
        .orderBy(asc(domainEvents.occurredAt))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });

      for (const row of rows) {
        const event: DeliveredEvent = {
          id: row.id,
          type: row.eventType,
          version: row.eventVersion,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          organizationId: row.organizationId,
          workspaceId: row.workspaceId,
          actorPrincipalId: row.actorPrincipalId,
          correlationId: row.correlationId,
          causationId: row.causationId,
          occurredAt: row.occurredAt,
          payload: row.payload as Record<string, unknown>,
        };

        try {
          await this.bus.publish(event);
          await tx
            .update(domainEvents)
            .set({ publishedAt: sql`now()`, status: 'published' })
            .where(eq(domainEvents.id, row.id));
        } catch (err) {
          const attempts = row.publishAttempts + 1;
          await tx
            .update(domainEvents)
            .set({
              publishAttempts: attempts,
              status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            })
            .where(eq(domainEvents.id, row.id));
          this.logger.error(
            { err, eventId: row.id, eventType: row.eventType, attempts },
            'relay publish failed; will retry',
          );
        }
      }

      return rows.length;
    });
  }
}
