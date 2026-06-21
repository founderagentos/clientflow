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
  PermissionCatalogService,
  RolePermissionService,
  RoleService,
  RoleAssignmentService,
  PERMISSION_CACHE,
  type PermissionCachePort,
  type PermissionRow,
  type RoleRow,
} from '@agentos/access';
import type { TenancyActor } from '../tenancy/tenancy-actor';

/**
 * Host orchestration for role + permission management (CLAUDE.md §6 Phase 4). Each write runs in
 * one tenant transaction that mutates state and appends its `PastTense` event to the outbox
 * atomically (§3.14); when a change alters effective permissions, the affected principals' caches
 * are invalidated after commit so revocation takes effect immediately (gate §7.5).
 */
@Injectable()
export class RoleManagementOrchestrator {
  constructor(
    private readonly roles: RoleService,
    private readonly permissions: PermissionCatalogService,
    private readonly rolePermissions: RolePermissionService,
    private readonly assignments: RoleAssignmentService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
  ) {}

  private scope(actor: TenancyActor) {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }

  private eventBase(actor: TenancyActor) {
    return {
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      actorPrincipalId: actor.principalId,
      correlationId: actor.correlationId,
      causationId: null,
    };
  }

  async listRoles(actor: TenancyActor): Promise<RoleRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) => this.roles.list(tx));
  }

  async listPermissions(actor: TenancyActor): Promise<PermissionRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) => this.permissions.list(tx));
  }

  async createRole(
    actor: TenancyActor,
    input: { name: string; scope: 'organization' | 'workspace' },
  ): Promise<{ roleId: string }> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const { roleId } = await this.roles.create(tx, {
        organizationId: actor.organizationId,
        scope: input.scope,
        name: input.name,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor),
        aggregateType: AccessAggregateType.Role,
        aggregateId: roleId,
        type: AccessEventType.RoleCreated,
        payload: { roleId, name: input.name, scope: input.scope },
      });
      return { roleId };
    });
  }

  async renameRole(
    actor: TenancyActor,
    roleId: string,
    input: { name: string; expectedVersion: number },
  ): Promise<void> {
    await withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const { changed } = await this.roles.rename(tx, {
        id: roleId,
        expectedVersion: input.expectedVersion,
        name: input.name,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor),
        aggregateType: AccessAggregateType.Role,
        aggregateId: roleId,
        type: AccessEventType.RoleUpdated,
        payload: { roleId, changed },
      });
    });
  }

  async archiveRole(
    actor: TenancyActor,
    roleId: string,
    input: { expectedVersion: number },
  ): Promise<void> {
    const affected = await withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const principals = await this.assignments.affectedPrincipals(tx, roleId);
      await this.roles.archive(tx, {
        id: roleId,
        expectedVersion: input.expectedVersion,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        ...this.eventBase(actor),
        aggregateType: AccessAggregateType.Role,
        aggregateId: roleId,
        type: AccessEventType.RoleDeleted,
        payload: { roleId },
      });
      return principals;
    });
    await this.invalidate(actor, affected);
  }

  async grantPermission(
    actor: TenancyActor,
    roleId: string,
    permissionKey: string,
  ): Promise<void> {
    const { affectedPrincipalIds } = await withTenantTransaction(
      this.db,
      this.scope(actor),
      async (tx) => {
        const result = await this.rolePermissions.grant(tx, { roleId, permissionKey });
        await this.outbox.append(tx, {
          ...this.eventBase(actor),
          aggregateType: AccessAggregateType.Role,
          aggregateId: roleId,
          type: AccessEventType.PermissionGranted,
          payload: { roleId, permissionKey },
        });
        return result;
      },
    );
    await this.invalidate(actor, affectedPrincipalIds);
  }

  async revokePermission(
    actor: TenancyActor,
    roleId: string,
    permissionKey: string,
  ): Promise<void> {
    const { affectedPrincipalIds } = await withTenantTransaction(
      this.db,
      this.scope(actor),
      async (tx) => {
        const result = await this.rolePermissions.revoke(tx, { roleId, permissionKey });
        await this.outbox.append(tx, {
          ...this.eventBase(actor),
          aggregateType: AccessAggregateType.Role,
          aggregateId: roleId,
          type: AccessEventType.PermissionRevoked,
          payload: { roleId, permissionKey },
        });
        return result;
      },
    );
    await this.invalidate(actor, affectedPrincipalIds);
  }

  private async invalidate(actor: TenancyActor, principalIds: string[]): Promise<void> {
    await Promise.all(
      principalIds.map((id) => this.cache.invalidate(id, actor.organizationId)),
    );
  }
}
