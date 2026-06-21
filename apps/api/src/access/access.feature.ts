import type { Redis } from 'ioredis';
import { AccessModule } from '@agentos/access';
import { REDIS } from '../redis/redis.tokens';

/**
 * The configured access module — built once and imported by reference wherever the PDP or the
 * access services are needed (the access host slice; the tenancy slice's controllers). Importing
 * the same DynamicModule reference lets Nest dedupe to one instance. The host supplies the shared
 * ioredis client for the permission cache (CLAUDE.md §17 — the library never imports the app root).
 */
export const AccessFeature = AccessModule.forRootAsync({
  inject: [REDIS],
  useRedisFactory: (redis: Redis) => redis,
});
