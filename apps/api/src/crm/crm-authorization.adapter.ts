import { Injectable } from '@nestjs/common';
import { ForbiddenError } from '@agentos/result-errors';
import { PolicyDecisionPoint } from '@agentos/access';
import type {
  AuthorizationPort,
  AuthorizationQuery,
  OwnershipScope,
  ScopeQuery,
} from '@agentos/authorization';

/**
 * The host adapter that binds the platform `AUTHORIZATION` port to the kernel PDP (RFC-002 §8.2). CRM
 * services depend on the port; only this host class (type:app) imports `@agentos/access`, so no CRM
 * module reaches into the access internals (CLAUDE.md §17). The kernel PDP stays pure RBAC — ownership
 * narrowing lives here: a principal may act on a specific record if it owns/is-assigned it, or is a
 * **manager** of that resource. Manager = holds the resource's `.delete` permission (only elevated
 * roles do; a Salesperson role with read/update-but-not-delete is narrowed to its own rows).
 */
@Injectable()
export class CrmAuthorizationAdapter implements AuthorizationPort {
  constructor(private readonly pdp: PolicyDecisionPoint) {}

  async authorize(query: AuthorizationQuery): Promise<void> {
    // Layer 2 default-deny on the coarse permission first.
    await this.pdp.authorizeOrThrow({
      principal: query.principal,
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
      permission: query.permission,
    });

    // Ownership narrowing, when this is an op on a specific owned record.
    if (query.resource && query.resourceOwnership) {
      const { ownerPrincipalId, assigneePrincipalId } = query.resourceOwnership;
      const isOwner = !!ownerPrincipalId && ownerPrincipalId === query.principal.id;
      const isAssignee = !!assigneePrincipalId && assigneePrincipalId === query.principal.id;
      if (!isOwner && !isAssignee && !(await this.isManager(query, query.resource))) {
        throw new ForbiddenError(
          `Not permitted: ${query.permission} on a ${query.resource} owned by another principal`,
        );
      }
    }
  }

  async scope(query: ScopeQuery): Promise<OwnershipScope> {
    return (await this.isManager(query, query.resource)) ? 'all' : 'own';
  }

  /** A principal manages a resource family iff it can delete it (RFC §8.2 "workspace-manager"). */
  private async isManager(
    query: { principal: AuthorizationQuery['principal']; organizationId: string; workspaceId: string },
    resource: string,
  ): Promise<boolean> {
    const decision = await this.pdp.decide({
      principal: query.principal,
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
      permission: `${resource}.delete`,
    });
    return decision.effect === 'allow';
  }
}
