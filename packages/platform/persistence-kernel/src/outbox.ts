import type { Tx } from './database';

/**
 * One domain event to append to the transactional outbox (CLAUDE.md §3.14/§3.15). Tenant
 * context is mandatory — events without organization_id/actor/correlation are prohibited.
 * Payloads carry only non-sensitive identifiers (§3.20).
 */
export interface OutboxEvent {
  aggregateType: string;
  aggregateId: string;
  /** PastTense event type, e.g. 'UserRegistered' (§3.15). */
  type: string;
  eventVersion?: number;
  organizationId: string;
  /** null = org-scoped event. */
  workspaceId: string | null;
  actorPrincipalId: string;
  correlationId: string;
  causationId: string | null;
  payload: Record<string, unknown>;
}

/**
 * The outbox-append capability, expressed as a kernel port so any bounded-context module can
 * emit events in its own transaction without importing the event-backbone module (which the
 * Nx boundaries forbid, CLAUDE.md §17). The event-backbone module provides the concrete writer
 * (it owns the `domain_events` table and the Phase 5 relay); modules depend only on this port.
 */
export interface OutboxPort {
  append(tx: Tx, event: OutboxEvent): Promise<string>;
}

/** DI token for {@link OutboxPort}; provided (globally) by the event-backbone module. */
export const OUTBOX = Symbol('agentos.outbox');
