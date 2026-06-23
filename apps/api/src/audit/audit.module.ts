import { Module } from '@nestjs/common';
import { AuditModule } from '@agentos/audit';
import { AccessFeature } from '../access/access.feature';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { AuditController } from './audit.controller';

/**
 * Host audit slice (CLAUDE.md §6 Phase 5) — the HTTP read surface for the audit trail plus the
 * PDP-backed permission guard. Imports the audit bounded-context module (the event consumer +
 * query side) and AccessFeature (the same single PDP instance the guard consults). The append-only
 * writer runs inside AuditModule via its MessageBus subscription; this slice only exposes the
 * `audit.read`-guarded query.
 */
@Module({
  imports: [AuditModule, AccessFeature],
  controllers: [AuditController],
  providers: [RequirePermissionGuard],
})
export class AuditHostModule {}
