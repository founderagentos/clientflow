import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuditLogView } from '@agentos/audit';
import { AuditQueryService } from '@agentos/audit';
import { currentActor } from '../tenancy/tenancy-actor';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { auditQuerySchema } from './audit.dto';

function toAuditView(entry: AuditLogView) {
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    workspaceId: entry.workspaceId,
    actorPrincipalId: entry.actorPrincipalId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    result: entry.result,
    ip: entry.ip,
    userAgent: entry.userAgent,
    correlationId: entry.correlationId,
    createdAt: entry.createdAt.toISOString(),
    metadata: entry.metadata,
  };
}

/**
 * Audit trail read API (`GET /api/v1/audit-log-entries`, CLAUDE.md §19). Defense in depth: the PDP
 * guard requires `audit.read` (layer 1), and the query runs under RLS so results are scoped to the
 * caller's organization at the database (layer 3). Newest-first, keyset-paginated via `cursor`.
 */
@Controller('audit-log-entries')
@UseGuards(RequirePermissionGuard)
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.read')
  async list(@Query() query: unknown) {
    const input = auditQuerySchema.parse(query);
    const actor = currentActor();
    const { entries, nextCursor } = await this.audit.list(
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      input,
    );
    return { entries: entries.map(toAuditView), nextCursor };
  }
}
