/**
 * Injection token for the ioredis client backing the permission cache. The access library owns
 * this token; the host binds it to its shared Redis client via `AccessModule.forRootAsync`
 * (CLAUDE.md §17 — a library never imports the app composition root).
 */
export const ACCESS_CACHE_REDIS = Symbol('agentos.access.cache-redis');
