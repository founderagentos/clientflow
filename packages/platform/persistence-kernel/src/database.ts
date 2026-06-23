import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** The Drizzle database handle bound to postgres.js (CLAUDE.md §2 — direct connection control). */
export type Database = PostgresJsDatabase;

/**
 * A Drizzle transaction handle — exactly the value the `work` callback of
 * {@link withTenantTransaction} receives. Repository / provisioning methods that participate
 * in a caller-owned unit of work accept this, so one registration can atomically span several
 * modules' tables in a single transaction (CLAUDE.md §3.14) without any module importing
 * another's internals (§17): the host opens the transaction and threads `Tx` through each
 * module's public service.
 */
export type Tx = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

/**
 * The minimal query surface shared by both a {@link Database} and a {@link Tx}. Repositories
 * accept this so the same method works for a non-transactional read (pre-auth lookups) and a
 * write enlisted in a caller's transaction.
 */
export type Executor = Pick<Tx, 'select' | 'insert' | 'update' | 'execute'>;

/**
 * DI token for the Drizzle database handle. Lives in the persistence kernel (not the app) so
 * bounded-context modules can inject the database without importing the app composition root,
 * which the Nx boundary rules forbid (CLAUDE.md §17). The app's DatabaseModule provides it.
 */
export const DATABASE = Symbol('agentos.persistence.database');

/**
 * DI token for a second Drizzle handle bound to the privileged `event_relay` connection
 * (BYPASSRLS, granted only SELECT/UPDATE on `domain_events` — db/policies). The Phase 5 relay is
 * cross-tenant infrastructure: it must read every organization's pending events, so it cannot use
 * the RLS-bound `app_user` pool (which would see only one tenant). Provided by the app's
 * DatabaseModule; injected by the event-backbone relay. Defined here (not in the app) for the
 * same boundary reason as {@link DATABASE} (CLAUDE.md §17).
 */
export const RELAY_DATABASE = Symbol('agentos.persistence.relay-database');
