import { Global, Inject, Module, type OnModuleDestroy, type Provider } from '@nestjs/common';
import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PG_CLIENT, RELAY_PG_CLIENT, DATABASE, RELAY_DATABASE } from './database.tokens';
import { DatabaseHealthIndicator } from './database.health-indicator';

export { PG_CLIENT, DATABASE, RELAY_DATABASE } from './database.tokens';

export type Database = PostgresJsDatabase;

const pgClientProvider: Provider = {
  provide: PG_CLIENT,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): Sql => postgres(config.DATABASE_URL, { max: 10 }),
};

const databaseProvider: Provider = {
  provide: DATABASE,
  inject: [PG_CLIENT],
  useFactory: (client: Sql): Database => drizzle(client),
};

// A second, smaller pool for the Phase 5 outbox relay, connecting as the privileged `event_relay`
// role (BYPASSRLS). Kept separate from the app_user pool so the relay's cross-tenant reads never
// share a connection that could leak RLS-bypassing access into request handling (CLAUDE.md §3.14).
const relayPgClientProvider: Provider = {
  provide: RELAY_PG_CLIENT,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): Sql => postgres(config.EVENT_RELAY_DATABASE_URL, { max: 4 }),
};

const relayDatabaseProvider: Provider = {
  provide: RELAY_DATABASE,
  inject: [RELAY_PG_CLIENT],
  useFactory: (client: Sql): Database => drizzle(client),
};

/**
 * Owns the connection pools and Drizzle handles. postgres.js connects lazily, so the app boots
 * without a reachable database — the health check reports the dependency as down. Two pools: the
 * RLS-bound `app_user` pool for request handling, and the privileged `event_relay` pool for the
 * outbox relay (CLAUDE.md §6 Phase 5).
 */
@Global()
@Module({
  providers: [
    pgClientProvider,
    databaseProvider,
    relayPgClientProvider,
    relayDatabaseProvider,
    DatabaseHealthIndicator,
  ],
  exports: [PG_CLIENT, DATABASE, RELAY_DATABASE, DatabaseHealthIndicator],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(
    @Inject(PG_CLIENT) private readonly client: Sql,
    @Inject(RELAY_PG_CLIENT) private readonly relayClient: Sql,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.client.end({ timeout: 5 }),
      this.relayClient.end({ timeout: 5 }),
    ]);
  }
}
