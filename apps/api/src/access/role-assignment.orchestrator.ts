import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { AccessAggregateType, AccessEventType } from '@agentos/contracts';
import {
  RoleAssignmentService,
  PERMISSION_CACHE,
  type PermissionCachePort,
} from '@agentos/access';
import type { TenancyActor } from '../tenancy/tenancy-actor';

/**
 * Host orchestration for assigning/revoking roles on a membership (CLAUDE.md §6 Phase 4). The
 * membership mutation and its `RoleAssigned`/`RoleRevoked` event commit atomically (§3.14); the
 * affected principal's permission cache is invalidated immediately after commit, so a revoked
 * role removes access on the very next request (gate §7.5).
 */
@Injectable()
export class RoleAssignmentOrchestrator {
  constructor(
    private readonly assignments: RoleAssignmentService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
  ) {}

  async assign(actor: TenancyActor, membershipId: string, roleId: string): Promise<void> {
    const { principalId } = await withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      async (tx) => {
        const result = await this.assignments.assign(tx, { membershipId, roleId });
        await this.outbox.append(tx, {
          organizationId: actor.organizationId,
          workspaceId: actor.workspaceId,
          actorPrincipalId: actor.principalId,
          correlationId: actor.correlationId,
          causationId: null,
          aggregateType: AccessAggregateType.Membership,
          aggregateId: membershipId,
          type: AccessEventType.RoleAssigned,
          payload: { membershipId, roleId, principalId: result.principalId, roleName: result.roleName },
        });
        return result;
      },
    );
    await this.cache.invalidate(principalId, actor.organizationId);
  }

  async revoke(actor: TenancyActor, membershipId: string, roleId: string): Promise<void> {
    const { principalId } = await withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      async (tx) => {
        const result = await this.assignments.revoke(tx, { membershipId, roleId });
        await this.outbox.append(tx, {
          organizationId: actor.organizationId,
          workspaceId: actor.workspaceId,
          actorPrincipalId: actor.principalId,
          correlationId: actor.correlationId,
          causationId: null,
          aggregateType: AccessAggregateType.Membership,
          aggregateId: membershipId,
          type: AccessEventType.RoleRevoked,
          payload: { membershipId, roleId, principalId: result.principalId },
        });
        return result;
      },
    );
    await this.cache.invalidate(principalId, actor.organizationId);
  }
}
