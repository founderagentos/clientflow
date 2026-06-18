import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  type Provider,
} from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { REDIS } from './redis.tokens';
import { RedisHealthIndicator } from './redis.health-indicator';

export { REDIS } from './redis.tokens';

const redisProvider: Provider = {
  provide: REDIS,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): Redis => {
    const client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    // Surface connectivity through the health check; swallow here to avoid unhandled errors.
    client.on('error', () => undefined);
    return client;
  },
};

@Global()
@Module({
  providers: [redisProvider, RedisHealthIndicator],
  exports: [REDIS, RedisHealthIndicator],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly client: Redis) {}

  async onModuleInit(): Promise<void> {
    // lazyConnect + enableOfflineQueue:false means an implicit connect-on-first-command
    // races the handshake and fails fast; connect explicitly at boot instead so later
    // commands (e.g. the health check) hit an already-ready connection.
    await this.client.connect().catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
