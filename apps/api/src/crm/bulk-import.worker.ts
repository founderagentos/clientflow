import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { parse } from 'csv-parse/sync';
import {
  LeadImportService,
  type ImportRow,
  type LeadActor,
} from '@agentos/crm-lead';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { BULK_IMPORT_QUEUE, bullmqConnectionOptions, type BulkImportJobData } from './bulk-import.tokens';

/** Rows processed per transaction — bounds row-lock duration on large files (RFC §4.B "chunked"). */
const CHUNK_SIZE = 500;
/** Cap the per-row error detail persisted to `error_report.jsonb` so it can't bloat the row. */
const MAX_ERRORS_STORED = 100;

/**
 * The bulk-import consumer (RFC-002 §4.B). Runs in-process with the app (mirrors the outbox
 * `RelayWorker` lifecycle): the BullMQ {@link Worker} starts on bootstrap and is closed on shutdown —
 * along with its **own** dedicated blocking connection (separate from the queue's, so the worker's
 * BRPOPLPUSH never monopolizes the producer connection). Leaving either open hangs the process, so
 * every e2e suite that boots the app depends on this clean shutdown.
 *
 * Per job: build the {@link LeadActor} from the payload, atomically `claim` the import job (a
 * re-delivery of an already-claimed job no-ops — idempotent), parse the CSV, stream rows through the
 * lead module's `importChunk` in chunks (a shared `seen` set dedupes within the file), then
 * `complete` (which emits the single `LeadImported`). A parse-level failure marks the job `failed`.
 */
@Injectable()
export class BulkImportWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BulkImportWorker.name);
  private worker: Worker<BulkImportJobData> | null = null;

  constructor(
    private readonly leadImport: LeadImportService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<BulkImportJobData>(
      BULK_IMPORT_QUEUE,
      (job) => this.process(job),
      { connection: bullmqConnectionOptions(this.config.REDIS_URL) },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ err, jobId: job?.id }, 'bulk import job failed');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      // close() stops accepting jobs, waits for in-flight processing, and closes BullMQ's connection.
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  private async process(job: Job<BulkImportJobData>): Promise<void> {
    const { importJobId, organizationId, workspaceId, principalId, correlationId, csv } = job.data;
    const actor: LeadActor = { principalId, organizationId, workspaceId, correlationId };

    const claimed = await this.leadImport.claim(actor, importJobId);
    if (!claimed) {
      // Already claimed/finished by a prior delivery — idempotent no-op.
      return;
    }

    try {
      const rows = parse(csv, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as ImportRow[];

      const seen = new Set<string>();
      const totals = { created: 0, skipped: 0, failed: 0 };
      const errors: Array<{ row: number; reason: string }> = [];

      for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
        const chunk = rows.slice(offset, offset + CHUNK_SIZE);
        const counts = await this.leadImport.importChunk(actor, chunk, offset, seen);
        totals.created += counts.created;
        totals.skipped += counts.skipped;
        totals.failed += counts.failed;
        for (const e of counts.errors) {
          if (errors.length < MAX_ERRORS_STORED) errors.push(e);
        }
      }

      await this.leadImport.complete(actor, importJobId, {
        totalRows: rows.length,
        created: totals.created,
        merged: 0,
        skipped: totals.skipped,
        failed: totals.failed,
        errorReport: { errors },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.leadImport.fail(actor, importJobId, message).catch(() => undefined);
      throw error;
    }
  }
}
