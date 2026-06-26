import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
  type Tx,
} from '@agentos/persistence-kernel';
import { newId } from '@agentos/identifier';
import { LeadAggregateType, LeadEventType, LeadStatus } from '@agentos/contracts';
import {
  ImportJobsRepository,
  type ImportJobRow,
} from '../infrastructure/import-jobs.repository';
import { LeadsRepository } from '../infrastructure/leads.repository';
import { normalizeDomain, normalizeEmail, normalizePhoneE164 } from '../domain/lead-normalization';
import type { LeadActor } from './lead-actor';

/** A raw CSV record (header → cell), as parsed by the host worker. */
export type ImportRow = Record<string, string>;

export interface ChunkCounts {
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
}

export interface FinalCounts {
  totalRows: number;
  created: number;
  merged: number;
  skipped: number;
  failed: number;
  errorReport: Record<string, unknown>;
}

const PHONE_COLUMN = 'phone';

/**
 * Bulk-import data logic (RFC-002 §4.B) — owned by the lead module so the domain stays free of the
 * queue/Redis infra (which lives in the host worker, CLAUDE.md §17). The host worker parses the CSV
 * and drives this service: `createOrGetJob` (idempotent on the Idempotency-Key) → `claim` →
 * `importChunk` per chunk → `complete` (emits the single `LeadImported`). Per-row inserts deliberately
 * do **not** emit `LeadCreated` — a multi-thousand-row import would otherwise storm the outbox; the
 * one summary event covers the run.
 *
 * Dedup policy (your call, §11): a row whose `email_normalized` matches an existing active lead OR an
 * earlier row in the same file (the caller's `seen` set) is **skipped**; a new email inserts; an
 * empty/unmappable row fails. `merged` is reserved (auto-merge is a later signal feature).
 */
@Injectable()
export class LeadImportService {
  constructor(
    private readonly jobs: ImportJobsRepository,
    private readonly leads: LeadsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /** Idempotent job creation — returns the existing job (without re-running) for a repeated key. */
  async createOrGetJob(
    actor: LeadActor,
    idempotencyKey: string,
  ): Promise<{ jobId: string; alreadyExists: boolean }> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const { job, created } = await this.jobs.createOrGet(tx, {
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        idempotencyKey,
        actorPrincipalId: actor.principalId,
      });
      return { jobId: job.id, alreadyExists: !created };
    });
  }

  /** Claim the job for processing (pending → processing). False if already claimed/finished. */
  async claim(actor: LeadActor, jobId: string): Promise<boolean> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.jobs.claimForProcessing(tx, jobId, actor.principalId),
    );
  }

  /**
   * Normalize + dedup + insert one chunk of raw rows, in a single tenant transaction. `rowOffset` is
   * the 0-based index of `rawRows[0]` within the whole file (for error reporting); `seen` accumulates
   * the in-file `email_normalized` values so duplicates across chunks are also skipped.
   */
  async importChunk(
    actor: LeadActor,
    rawRows: ImportRow[],
    rowOffset: number,
    seen: Set<string>,
  ): Promise<ChunkCounts> {
    const result: ChunkCounts = { created: 0, skipped: 0, failed: 0, errors: [] };
    await withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      for (let i = 0; i < rawRows.length; i++) {
        const rowNumber = rowOffset + i + 1; // 1-based for humans
        try {
          const mapped = this.mapRow(rawRows[i]!);
          if (!mapped) {
            result.failed++;
            result.errors.push({ row: rowNumber, reason: 'empty or unmappable row' });
            continue;
          }
          if (mapped.emailNormalized) {
            if (seen.has(mapped.emailNormalized)) {
              result.skipped++;
              continue;
            }
            const existing = await this.leads.findActiveByEmailNormalized(tx, mapped.emailNormalized);
            if (existing) {
              result.skipped++;
              seen.add(mapped.emailNormalized);
              continue;
            }
            seen.add(mapped.emailNormalized);
          }
          await this.leads.insert(tx, {
            id: newId(),
            organizationId: actor.organizationId,
            workspaceId: actor.workspaceId,
            status: LeadStatus.New,
            source: mapped.source,
            name: mapped.name,
            email: mapped.email,
            emailNormalized: mapped.emailNormalized,
            phoneE164: mapped.phoneE164,
            domain: mapped.domain,
            ownerPrincipalId: null,
            customFields: {},
            actorPrincipalId: actor.principalId,
          });
          result.created++;
        } catch (error) {
          result.failed++;
          result.errors.push({ row: rowNumber, reason: messageOf(error) });
        }
      }
    });
    return result;
  }

  /** Finalize the job (status=completed + counts + error report) and emit the single `LeadImported`. */
  async complete(actor: LeadActor, jobId: string, counts: FinalCounts): Promise<void> {
    await withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const job = await this.requireJob(tx, jobId);
      await this.jobs.complete(tx, {
        id: jobId,
        counts,
        actorPrincipalId: actor.principalId,
        expectedVersion: job.version,
      });
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: LeadAggregateType.ImportJob,
        aggregateId: jobId,
        type: LeadEventType.LeadImported,
        payload: {
          importJobId: jobId,
          created: counts.created,
          merged: counts.merged,
          skipped: counts.skipped,
          failed: counts.failed,
        },
      });
    });
  }

  /** Mark the job failed (worker-level failure, e.g. an unparseable file). No `LeadImported`. */
  async fail(actor: LeadActor, jobId: string, message: string): Promise<void> {
    await withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.jobs.fail(tx, { id: jobId, errorReport: { error: message }, actorPrincipalId: actor.principalId }),
    );
  }

  async getJob(actor: LeadActor, jobId: string): Promise<ImportJobRow> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) => this.requireJob(tx, jobId));
  }

  /** Map a CSV record to lead fields + normalized signals. Returns null if nothing usable. */
  private mapRow(raw: ImportRow): {
    name: string | null;
    email: string | null;
    emailNormalized: string | null;
    phoneE164: string | null;
    domain: string | null;
    source: string | null;
  } | null {
    const pick = (key: string): string | null => {
      const value = raw[key];
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };
    const name = pick('name');
    const email = pick('email');
    const domain = normalizeDomain(pick('domain'));
    const source = pick('source');
    const phoneE164 = normalizePhoneE164(pick(PHONE_COLUMN));
    // A row with no name, email, or domain carries no usable lead data.
    if (!name && !email && !domain) {
      return null;
    }
    return { name, email, emailNormalized: normalizeEmail(email), phoneE164, domain, source };
  }

  private async requireJob(tx: Tx, id: string): Promise<ImportJobRow> {
    const row = await this.jobs.findById(tx, id);
    if (!row) {
      throw new NotFoundError('Import job not found');
    }
    return row;
  }

  private scope(actor: LeadActor): { organizationId: string; workspaceId: string } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
