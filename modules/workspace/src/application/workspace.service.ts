import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { newId } from '@agentos/identifier';
import { TenancyAggregateType, TenancyEventType } from '@agentos/contracts';
import { WorkspacesRepository, type WorkspaceRow } from '../infrastructure/workspaces.repository';
import { assertDepthWithinLimit } from '../domain/workspace-depth';

/** Acting principal + active tenant context, resolved by the host from the access token. */
export interface WorkspaceActor {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  correlationId: string;
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  parentWorkspaceId?: string | null;
}

/**
 * Workspace lifecycle within the active organization (CLAUDE.md §6 Phase 3): create (with
 * bounded nesting ≤ 3), rename/re-slug (optimistic-locked), and archive (cascading soft-delete).
 * Every operation runs in a tenant transaction and emits its PastTense event to the outbox in the
 * same unit of work (§3.14). Cross-tenant ids simply return no row under RLS → 404 (§3.8).
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly workspaces: WorkspacesRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async list(actor: WorkspaceActor): Promise<WorkspaceRow[]> {
    return withTenantTransaction(this.db, this.scope(actor), (tx) =>
      this.workspaces.listByOrganization(tx),
    );
  }

  async get(actor: WorkspaceActor, id: string): Promise<WorkspaceRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const row = await this.workspaces.findById(tx, id);
      if (!row) {
        throw new NotFoundError('Workspace not found');
      }
      return row;
    });
  }

  async create(actor: WorkspaceActor, input: CreateWorkspaceInput): Promise<WorkspaceRow> {
    const parentWorkspaceId = input.parentWorkspaceId ?? null;
    const workspaceId = newId();
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      if (parentWorkspaceId) {
        const parent = await this.workspaces.findById(tx, parentWorkspaceId);
        if (!parent) {
          // Cross-tenant or missing parent — never confirm existence (§3.8).
          throw new NotFoundError('Parent workspace not found');
        }
        const parentDepth = await this.workspaces.computeDepth(tx, parentWorkspaceId);
        assertDepthWithinLimit(parentDepth);
      }
      await this.workspaces.insert(tx, {
        id: workspaceId,
        organizationId: actor.organizationId,
        parentWorkspaceId,
        slug: input.slug,
        name: input.name,
        actorPrincipalId: actor.principalId,
      });
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: TenancyAggregateType.Workspace,
        aggregateId: workspaceId,
        type: TenancyEventType.WorkspaceCreated,
        payload: { workspaceId, parentWorkspaceId, slug: input.slug, name: input.name },
      });
      const created = await this.workspaces.findById(tx, workspaceId);
      if (!created) {
        throw new NotFoundError('Workspace not found');
      }
      return created;
    });
  }

  async update(
    actor: WorkspaceActor,
    id: string,
    expectedVersion: number,
    fields: { name?: string | undefined; slug?: string | undefined },
  ): Promise<WorkspaceRow> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.workspaces.findById(tx, id);
      if (!existing) {
        throw new NotFoundError('Workspace not found');
      }
      const changed = await this.workspaces.update(tx, {
        id,
        expectedVersion,
        actorPrincipalId: actor.principalId,
        fields,
      });
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: id,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: TenancyAggregateType.Workspace,
        aggregateId: id,
        type: TenancyEventType.WorkspaceUpdated,
        payload: { workspaceId: id, changed },
      });
      const updated = await this.workspaces.findById(tx, id);
      if (!updated) {
        throw new NotFoundError('Workspace not found');
      }
      return updated;
    });
  }

  async archive(actor: WorkspaceActor, id: string, expectedVersion: number): Promise<void> {
    return withTenantTransaction(this.db, this.scope(actor), async (tx) => {
      const existing = await this.workspaces.findById(tx, id);
      if (!existing) {
        throw new NotFoundError('Workspace not found');
      }
      // Snapshot the subtree before archiving the root (the CTE excludes deleted rows).
      const subtreeIds = await this.workspaces.listSubtreeIds(tx, id);
      const cascadedWorkspaceIds = subtreeIds.filter((sid) => sid !== id);
      await this.workspaces.archive(tx, {
        id,
        expectedVersion,
        actorPrincipalId: actor.principalId,
      });
      await this.workspaces.archiveCascade(tx, cascadedWorkspaceIds, actor.principalId);
      await this.outbox.append(tx, {
        organizationId: actor.organizationId,
        workspaceId: id,
        actorPrincipalId: actor.principalId,
        correlationId: actor.correlationId,
        causationId: null,
        aggregateType: TenancyAggregateType.Workspace,
        aggregateId: id,
        type: TenancyEventType.WorkspaceArchived,
        payload: { workspaceId: id, cascadedWorkspaceIds },
      });
    });
  }

  private scope(actor: WorkspaceActor): { organizationId: string; workspaceId: string | null } {
    return { organizationId: actor.organizationId, workspaceId: actor.workspaceId };
  }
}
