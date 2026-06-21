import { Injectable } from '@nestjs/common';
import { newId } from '@agentos/identifier';
import type { Tx } from '@agentos/persistence-kernel';
import { PrincipalsRepository } from '../infrastructure/principals.repository';
import {
  ServiceAccountsRepository,
  type ServiceAccountRow,
} from '../infrastructure/service-accounts.repository';

/**
 * Service-account lifecycle (CLAUDE.md §3.2) — creates the principal supertype row and its
 * service-account specialization in one shared-PK pair, so an AI agent/automation becomes a
 * first-class principal authorized by the same PDP as a human. Takes the caller's transaction;
 * the host orchestrator owns the unit of work and emits `ServiceAccountCreated`.
 */
@Injectable()
export class ServiceAccountService {
  constructor(
    private readonly principals: PrincipalsRepository,
    private readonly serviceAccounts: ServiceAccountsRepository,
  ) {}

  async create(
    tx: Tx,
    input: {
      organizationId: string;
      workspaceId: string;
      name: string;
      description?: string | null;
      kind: 'agent' | 'automation' | 'integration';
      actorPrincipalId: string;
    },
  ): Promise<{ serviceAccountId: string }> {
    const serviceAccountId = newId();
    await this.principals.insertServiceAccountPrincipal(tx, serviceAccountId);
    await this.serviceAccounts.insert(tx, {
      id: serviceAccountId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind,
      actorPrincipalId: input.actorPrincipalId,
    });
    return { serviceAccountId };
  }

  async list(tx: Tx): Promise<ServiceAccountRow[]> {
    return this.serviceAccounts.listByOrganization(tx);
  }

  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    await this.serviceAccounts.archive(tx, input);
  }
}
