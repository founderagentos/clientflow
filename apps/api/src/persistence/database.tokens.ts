/** Raw postgres.js client (low-level ops like SET LOCAL / health probes). */
export const PG_CLIENT = Symbol('PG_CLIENT');
/** Raw postgres.js client for the privileged `event_relay` pool (Phase 5 relay). */
export const RELAY_PG_CLIENT = Symbol('RELAY_PG_CLIENT');
/**
 * Drizzle database handle tokens. Sourced from the persistence kernel (not defined here) so
 * bounded-context modules can inject the same token without importing the app (CLAUDE.md §17).
 * RELAY_DATABASE is the second handle bound to the event_relay (BYPASSRLS) connection.
 */
export { DATABASE, RELAY_DATABASE } from '@agentos/persistence-kernel';
