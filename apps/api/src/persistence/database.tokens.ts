/** Raw postgres.js client (low-level ops like SET LOCAL / health probes). */
export const PG_CLIENT = Symbol('PG_CLIENT');
/**
 * Drizzle database handle token. Sourced from the persistence kernel (not defined here) so
 * bounded-context modules can inject the same token without importing the app (CLAUDE.md §17).
 */
export { DATABASE } from '@agentos/persistence-kernel';
