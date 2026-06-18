import { Injectable } from '@nestjs/common';
import type { Tx } from '@agentos/persistence-kernel';
import { workspaces } from '../infrastructure/workspaces.schema';

export interface CreateDefaultWorkspaceInput {
  organizationId: string;
  workspaceId: string;
  actorPrincipalId: string;
  name?: string;
  slug?: string;
}

export interface ProvisionedWorkspace {
  workspaceId: string;
  slug: string;
  name: string;
}

/** Public provisioning service: the default workspace created with every personal org
 * (CLAUDE.md §3.1), inside the caller's transaction. */
@Injectable()
export class WorkspaceProvisioner {
  async createDefault(tx: Tx, input: CreateDefaultWorkspaceInput): Promise<ProvisionedWorkspace> {
    const slug = input.slug ?? 'default';
    const name = input.name ?? 'Default Workspace';
    await tx.insert(workspaces).values({
      id: input.workspaceId,
      organizationId: input.organizationId,
      slug,
      name,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
    return { workspaceId: input.workspaceId, slug, name };
  }
}
