import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictError } from '@agentos/result-errors';
import {
  assertVersionMatched,
  nextVersion,
  softDeletePatch,
  type Tx,
} from '@agentos/persistence-kernel';
import { serviceAccounts } from './service-accounts.schema';

export interface ServiceAccountRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  kind: string;
  version: number;
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION
  );
}

/**
 * Reads/writes service accounts within the active organization (CLAUDE.md §3.2). A service
 * account is a shared-PK specialization of `principals` (its `id` equals the principal's id) and
 * always belongs to exactly one workspace. Every method runs inside a tenant transaction
 * (service_accounts RLS = `organization_id = app.current_organization_id`).
 */
@Injectable()
export class ServiceAccountsRepository {
  private columns = {
    id: serviceAccounts.id,
    organizationId: serviceAccounts.organizationId,
    workspaceId: serviceAccounts.workspaceId,
    name: serviceAccounts.name,
    kind: serviceAccounts.kind,
    version: serviceAccounts.version,
  };

  async insert(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      workspaceId: string;
      name: string;
      description: string | null;
      kind: 'agent' | 'automation' | 'integration';
      actorPrincipalId: string;
    },
  ): Promise<void> {
    try {
      await tx.insert(serviceAccounts).values({
        id: input.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description,
        kind: input.kind,
        createdBy: input.actorPrincipalId,
        updatedBy: input.actorPrincipalId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A service account with this name already exists');
      }
      throw error;
    }
  }

  async findById(tx: Tx, id: string): Promise<ServiceAccountRow | null> {
    const [row] = await tx
      .select(this.columns)
      .from(serviceAccounts)
      .where(and(eq(serviceAccounts.id, id), isNull(serviceAccounts.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async listByOrganization(tx: Tx): Promise<ServiceAccountRow[]> {
    return tx
      .select(this.columns)
      .from(serviceAccounts)
      .where(isNull(serviceAccounts.deletedAt))
      .orderBy(serviceAccounts.createdAt);
  }

  async archive(
    tx: Tx,
    input: { id: string; expectedVersion: number; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(serviceAccounts)
      .set({ ...softDeletePatch(input.actorPrincipalId), version: nextVersion(input.expectedVersion) })
      .where(
        and(
          eq(serviceAccounts.id, input.id),
          eq(serviceAccounts.version, input.expectedVersion),
          isNull(serviceAccounts.deletedAt),
        ),
      )
      .returning({ id: serviceAccounts.id });
    assertVersionMatched(rows.length);
  }
}
