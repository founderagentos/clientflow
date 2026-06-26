/** The bulk-import queue name (one queue, one worker). */
export const BULK_IMPORT_QUEUE = 'crm-bulk-import';

/** The BullMQ job payload — the CSV rides in Redis for Stage 1 (object-storage streaming is later). */
export interface BulkImportJobData {
  importJobId: string;
  organizationId: string;
  workspaceId: string;
  principalId: string;
  correlationId: string;
  csv: string;
}

/**
 * Build BullMQ connection **options** (not an ioredis instance) from `REDIS_URL`. BullMQ creates and
 * owns the connection (closed by `queue.close()`/`worker.close()`), which keeps the queue and the
 * worker's blocking loop on separate connections and avoids passing a cross-version ioredis instance
 * across the BullMQ type boundary. `maxRetriesPerRequest: null` is mandatory for BullMQ's blocking
 * worker commands — the shared `RedisModule` client (configured `maxRetriesPerRequest: 1`) can't be
 * reused for that.
 */
export function bullmqConnectionOptions(redisUrl: string): {
  host: string;
  port: number;
  maxRetriesPerRequest: null;
  username?: string;
  password?: string;
  db?: number;
} {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
  };
}
