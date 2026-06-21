import { Injectable } from '@nestjs/common';
import { newId } from '@agentos/identifier';
import type { Tx } from '@agentos/persistence-kernel';
import { RolesRepository, type RoleRow } from '../infrastructure/roles.repository';

/**
 * Custom-role lifecycle within the active organization (CLAUDE.md §6 Phase 4). System roles are
 * read in listings but immutable (the repository rejects mutation). Each method takes the
 * caller's transaction; the host orchestrator owns the unit of work and event emission.
 */
@Injectable()
export class RoleService {
  constructor(private readonly roles: RolesRepository) {}

  async create(
    tx: Tx,
    input: {
      organizationId: string;
      scope: 'organization' | 'workspace';
      name: string;
      actorPrincipalId: string;
    },
  ): Promise<{ roleId: string }> {
    const roleId = newId();
    await this.roles.insert(tx, {
      id: roleId,
      organizationId: input.organizationId,
      scope: input.scope,
      name: input.name,
      actorPrincipalId: input.actorPrincipalId,
    });
    return { roleId };
  }

  async list(tx: Tx): Promise<RoleRow[]> {
    return this.roles.listVisible(tx);
  }

  async rename(
    tx: Tx,
    input: { id: string; expectedVersion: number; name: string; actorPrincipalId: string },
  ): Promise<{ changed: string[] }> {
    const changed = await this.roles.update(tx, {
      id: input.id,
      expectedVersion: input.expectedVersion,
      actorPrincipalId: input.actorPrincipalId,
      fields: { name: input.name },
    });
    return { changed };
  }

  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    await this.roles.archive(tx, input);
  }
}
