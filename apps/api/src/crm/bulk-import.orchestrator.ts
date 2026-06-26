import { Injectable } from '@nestjs/common';
import { LeadImportService, type ImportJobRow, type LeadActor } from '@agentos/crm-lead';
import { BulkImportQueue } from './bulk-import.queue';

export interface SubmitImportInput {
  /** The caller-supplied Idempotency-Key (HTTP header in Phase 6); resubmits with it are no-ops. */
  idempotencyKey: string;
  csv: string;
}

export interface SubmitImportResult {
  jobId: string;
  /** True when a prior submit already owns this key — nothing was enqueued this time. */
  alreadyExists: boolean;
}

/**
 * Bulk-import submission (RFC-002 §3.2/§4.B) — the host orchestrator that ties the lead module's
 * idempotent job creation to the BullMQ queue. `createOrGetJob` is idempotent on the Idempotency-Key;
 * the queue is only fed when a **new** job row was created, so re-submitting the same key returns the
 * existing job and never double-creates leads (the Phase-4 gate). The CSV rides in the job payload
 * (Stage-1; object-storage streaming is later). Phase 6's `POST /imports` controller calls this.
 */
@Injectable()
export class BulkImportOrchestrator {
  constructor(
    private readonly leadImport: LeadImportService,
    private readonly queue: BulkImportQueue,
  ) {}

  async submit(actor: LeadActor, input: SubmitImportInput): Promise<SubmitImportResult> {
    const { jobId, alreadyExists } = await this.leadImport.createOrGetJob(actor, input.idempotencyKey);
    if (!alreadyExists) {
      await this.queue.enqueue({
        importJobId: jobId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        principalId: actor.principalId,
        correlationId: actor.correlationId,
        csv: input.csv,
      });
    }
    return { jobId, alreadyExists };
  }

  async getJob(actor: LeadActor, jobId: string): Promise<ImportJobRow> {
    return this.leadImport.getJob(actor, jobId);
  }
}
