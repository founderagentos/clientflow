import { Global, Inject, Module, type OnModuleDestroy, type Provider } from '@nestjs/common';
import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PG_CLIENT, DATABASE } from './database.tokens';
import { DatabaseHealthIndicator } from './database.health-indicator';

export { PG_CLIENT, DATABASE } from './database.tokens';

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

/**
 * Owns the connection pool and the Drizzle handle. postgres.js connects lazily, so the app
 * boots without a reachable database — the health check reports the dependency as down.
 */
@Global()
@Module({
  providers: [pgClientProvider, databaseProvider, DatabaseHealthIndicator],
  exports: [PG_CLIENT, DATABASE, DatabaseHealthIndicator],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_CLIENT) private readonly client: Sql) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
