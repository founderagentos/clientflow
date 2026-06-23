import { Inject, Injectable } from '@nestjs/common';
import { ValidationError } from '@agentos/result-errors';
import { DATABASE, withTenantTransaction, type Database } from '@agentos/persistence-kernel';
import {
  AuditLogEntriesRepository,
  type AuditCursor,
  type AuditLogView,
} from '../infrastructure/audit-log-entries.repository';

/** The active tenant the query runs in (RLS scopes results to it). */
export interface AuditQueryScope {
  organizationId: string;
  workspaceId: string | null;
}

export interface AuditListInput {
  // `| undefined` is explicit so a Zod-parsed query object (whose optional keys are `T | undefined`)
  // assigns cleanly under `exactOptionalPropertyTypes`; `list` strips undefined before querying.
  actorPrincipalId?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  action?: string | undefined;
  result?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Opaque keyset cursor returned as `nextCursor` from a prior page. */
  cursor?: string | undefined;
  limit: number;
}

export interface AuditListResult {
  entries: AuditLogView[];
  /** Pass back as `cursor` to fetch the next page; null when the trail is exhausted. */
  nextCursor: string | null;
}

function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

function decodeCursor(token: string): AuditCursor {
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  const createdAt = sep === -1 ? new Date(NaN) : new Date(decoded.slice(0, sep));
  const id = sep === -1 ? '' : decoded.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new ValidationError('Invalid pagination cursor');
  }
  return { createdAt, id };
}

/**
 * Read side of the audit trail (CLAUDE.md §6 Phase 5). Runs inside `withTenantTransaction`, so the
 * `audit_log_entries` RLS policy scopes results to the caller's organization — the same database
 * isolation that protects every other tenant table (gate §7.1). Authorization (`audit.read`) is
 * enforced one layer up by the PDP guard on the HTTP route.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repository: AuditLogEntriesRepository,
  ) {}

  async list(scope: AuditQueryScope, input: AuditListInput): Promise<AuditListResult> {
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;

    // Fetch one extra row to tell whether a further page exists without a second query.
    const rows = await withTenantTransaction(this.db, scope, (tx) =>
      this.repository.query(tx, {
        ...(input.actorPrincipalId !== undefined && { actorPrincipalId: input.actorPrincipalId }),
        ...(input.resourceType !== undefined && { resourceType: input.resourceType }),
        ...(input.resourceId !== undefined && { resourceId: input.resourceId }),
        ...(input.action !== undefined && { action: input.action }),
        ...(input.result !== undefined && { result: input.result }),
        ...(input.from !== undefined && { from: input.from }),
        ...(input.to !== undefined && { to: input.to }),
        ...(cursor !== undefined && { cursor }),
        limit: input.limit + 1,
      }),
    );

    const hasMore = rows.length > input.limit;
    const entries = hasMore ? rows.slice(0, input.limit) : rows;
    const last = entries[entries.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return { entries, nextCursor };
  }
}
