/** Shared ioredis client (permission cache, rate-limit store, idempotency keys — later phases). */
export const REDIS = Symbol('REDIS');
