import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { BULK_IMPORT_QUEUE, bullmqConnectionOptions, type BulkImportJobData } from './bulk-import.tokens';

/**
 * The bulk-import producer (RFC-002 §4.B). Wraps a BullMQ {@link Queue} on its own BullMQ-managed
 * connection. The BullMQ `jobId` is set to the `import_jobs` row id, so the queue itself dedupes a
 * re-enqueue of the same job (defense in depth behind the `UNIQUE(org, idempotency_key)` guard);
 * `attempts: 1` means a failed import is never silently re-run (which could double-insert) — it is
 * reported `failed`.
 */
@Injectable()
export class BulkImportQueue implements OnApplicationShutdown {
  private readonly queue: Queue<BulkImportJobData>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.queue = new Queue<BulkImportJobData>(BULK_IMPORT_QUEUE, {
      connection: bullmqConnectionOptions(config.REDIS_URL),
    });
  }

  async enqueue(data: BulkImportJobData): Promise<void> {
    await this.queue.add('import', data, {
      jobId: data.importJobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}
