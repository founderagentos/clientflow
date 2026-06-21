import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@agentos/identifier';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { AccessAggregateType, AccessEventType } from '@agentos/contracts';
import { ServiceAccountService, type ServiceAccountRow } from '@agentos/identity';
import { MembershipWriter } from '@agentos/workspace';
import {
  RoleAssignmentService,
  PERMISSION_CACHE,
  type PermissionCachePort,
} from '@agentos/access';
import type { TenancyActor } from '../tenancy/tenancy-actor';
import type { CreateServiceAccountBody } from './access.dto';

/**
 * Host orchestration for service accounts (CLAUDE.md §3.2). Creates the principal + service
 * account and, when a role is supplied, grants it a workspace membership and assigns that role —
 * so the agent is immediately authorizable through the same PDP as a human. All state and its
 * `ServiceAccountCreated`/`RoleAssigned` events commit in one transaction (§3.14).
 */
@Injectable()
export class ServiceAccountOrchestrator {
  constructor(
    private readonly serviceAccounts: ServiceAccountService,
    private readonly memberships: MembershipWriter,
    private readonly assignments: RoleAssignmentService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
  ) {}

  async create(
    actor: TenancyActor,
    input: CreateServiceAccountBody,
  ): Promise<{ serviceAccountId: string; membershipId: string | null }> {
    const result = await withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: input.workspaceId },
      async (tx) => {
        const { serviceAccountId } = await this.serviceAccounts.create(tx, {
          organizationId: actor.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          description: input.description ?? null,
          kind: input.kind,
          actorPrincipalId: actor.principalId,
        });
        await this.outbox.append(tx, {
          organizationId: actor.organizationId,
          workspaceId: input.workspaceId,
          actorPrincipalId: actor.principalId,
          correlationId: actor.correlationId,
          causationId: null,
          aggregateType: AccessAggregateType.ServiceAccount,
          aggregateId: serviceAccountId,
          type: AccessEventType.ServiceAccountCreated,
          payload: { serviceAccountId, name: input.name },
        });

        let membershipId: string | null = null;
        if (input.roleId) {
          membershipId = newId();
          await this.memberships.grantMembership(tx, {
            membershipId,
            organizationId: actor.organizationId,
            workspaceId: input.workspaceId,
            principalId: serviceAccountId,
            status: 'active',
            actorPrincipalId: actor.principalId,
          });
          const assigned = await this.assignments.assign(tx, {
            membershipId,
            roleId: input.roleId,
          });
          await this.outbox.append(tx, {
            organizationId: actor.organizationId,
            workspaceId: input.workspaceId,
            actorPrincipalId: actor.principalId,
            correlationId: actor.correlationId,
            causationId: null,
            aggregateType: AccessAggregateType.Membership,
            aggregateId: membershipId,
            type: AccessEventType.RoleAssigned,
            payload: {
              membershipId,
              roleId: input.roleId,
              principalId: serviceAccountId,
              roleName: assigned.roleName,
            },
          });
        }
        return { serviceAccountId, membershipId };
      },
    );
    await this.cache.invalidate(result.serviceAccountId, actor.organizationId);
    return result;
  }

  async list(actor: TenancyActor): Promise<ServiceAccountRow[]> {
    return withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      (tx) => this.serviceAccounts.list(tx),
    );
  }

  async archive(actor: TenancyActor, id: string, expectedVersion: number): Promise<void> {
    await withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      (tx) => this.serviceAccounts.archive(tx, { id, expectedVersion, actorPrincipalId: actor.principalId }),
    );
    await this.cache.invalidate(id, actor.organizationId);
  }
}
