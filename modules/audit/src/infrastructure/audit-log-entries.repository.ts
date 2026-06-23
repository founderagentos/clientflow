import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '@agentos/persistence-kernel';
import { auditLogEntries } from './audit-log-entries.schema';

/** A row to append to the audit trail. `sourceEventId` makes the write idempotent. */
export interface NewAuditEntry {
  organizationId: string;
  workspaceId: string | null;
  actorPrincipalId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
  sourceEventId: string | null;
  metadata: Record<string, unknown>;
}

/** A read-side projection of an audit entry (no internal plumbing like `source_event_id`). */
export interface AuditLogView {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  actorPrincipalId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

/** Keyset cursor — the last `(createdAt, id)` of the previous page. */
export interface AuditCursor {
  createdAt: Date;
  id: string;
}

export interface AuditQueryFilters {
  actorPrincipalId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  result?: string;
  from?: Date;
  to?: Date;
  cursor?: AuditCursor;
  limit: number;
}

const VIEW_COLUMNS = {
  id: auditLogEntries.id,
  organizationId: auditLogEntries.organizationId,
  workspaceId: auditLogEntries.workspaceId,
  actorPrincipalId: auditLogEntries.actorPrincipalId,
  action: auditLogEntries.action,
  resourceType: auditLogEntries.resourceType,
  resourceId: auditLogEntries.resourceId,
  result: auditLogEntries.result,
  ip: auditLogEntries.ip,
  userAgent: auditLogEntries.userAgent,
  correlationId: auditLogEntries.correlationId,
  createdAt: auditLogEntries.createdAt,
  metadata: auditLogEntries.metadata,
};

/**
 * Append-only access to `audit_log_entries` (CLAUDE.md §5 — SELECT/INSERT only, no UPDATE/DELETE).
 * Both methods take a tenant-enlisted executor (a {@link Tx} from `withTenantTransaction`), so RLS
 * scopes every read and check every insert to the active organization.
 */
@Injectable()
export class AuditLogEntriesRepository {
  /**
   * Append an entry, ignoring a re-delivery of the same source event (at-least-once delivery,
   * CLAUDE.md §3.14). The `ON CONFLICT (source_event_id) DO NOTHING` is what makes the consumer
   * idempotent — the second delivery is a successful no-op, so the relay can still mark the event
   * published.
   */
  async append(tx: Tx, entry: NewAuditEntry): Promise<void> {
    await tx
      .insert(auditLogEntries)
      .values(entry)
      .onConflictDoNothing({ target: auditLogEntries.sourceEventId });
  }

  /**
   * Page the trail newest-first with keyset pagination on `(created_at, id)` — uses the
   * `(organization_id, created_at DESC)` index (RLS adds the organization predicate), so deep
   * pages stay O(limit) instead of degrading like OFFSET. Org scoping is enforced by RLS.
   */
  async query(executor: Executor, filters: AuditQueryFilters): Promise<AuditLogView[]> {
    const conditions: SQL[] = [];
    if (filters.actorPrincipalId) {
      conditions.push(eq(auditLogEntries.actorPrincipalId, filters.actorPrincipalId));
    }
    if (filters.resourceType) {
      conditions.push(eq(auditLogEntries.resourceType, filters.resourceType));
    }
    if (filters.resourceId) {
      conditions.push(eq(auditLogEntries.resourceId, filters.resourceId));
    }
    if (filters.action) {
      conditions.push(eq(auditLogEntries.action, filters.action));
    }
    if (filters.result) {
      conditions.push(eq(auditLogEntries.result, filters.result));
    }
    if (filters.from) {
      conditions.push(gte(auditLogEntries.createdAt, filters.from));
    }
    if (filters.to) {
      conditions.push(lte(auditLogEntries.createdAt, filters.to));
    }
    if (filters.cursor) {
      // Row-value comparison matches the ORDER BY (created_at DESC, id DESC) exactly.
      conditions.push(
        sql`(${auditLogEntries.createdAt}, ${auditLogEntries.id}) < (${filters.cursor.createdAt}, ${filters.cursor.id})`,
      );
    }

    const rows = await executor
      .select(VIEW_COLUMNS)
      .from(auditLogEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogEntries.createdAt), desc(auditLogEntries.id))
      .limit(filters.limit);

    // `metadata` is a jsonb column (Drizzle types it `unknown`); the trail only ever stores a
    // JSON object, so present it as such to callers.
    return rows.map((row) => ({ ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> }));
  }
}
