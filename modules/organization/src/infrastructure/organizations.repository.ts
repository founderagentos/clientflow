import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { assertVersionMatched, nextVersion, type Tx } from '@agentos/persistence-kernel';
import { organizations } from './organizations.schema';

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  homeRegion: string | null;
  planTierCache: string | null;
  dataProcessingConsent: boolean;
  version: number;
  metadata: unknown;
}

export interface UpdateOrganizationFields {
  name?: string | undefined;
  homeRegion?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Reads/writes the tenant-root organization. Every method runs inside a tenant transaction
 * (the `organizations` RLS policy is `id = app.current_organization_id`, so an unset GUC errors
 * — there is no untenanted read). The service layer opens that transaction; a caller therefore
 * only ever sees its own organization, which is why reads take the id from the active context
 * rather than from untrusted input.
 */
@Injectable()
export class OrganizationsRepository {
  async findById(tx: Tx, id: string): Promise<OrganizationRow | null> {
    const [row] = await tx
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        status: organizations.status,
        homeRegion: organizations.homeRegion,
        planTierCache: organizations.planTierCache,
        dataProcessingConsent: organizations.dataProcessingConsent,
        version: organizations.version,
        metadata: organizations.metadata,
      })
      .from(organizations)
      .where(and(eq(organizations.id, id), isNull(organizations.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Optimistic-locked field update (§3.4): matches on `version = expectedVersion` and bumps it;
   * a zero row count means a concurrent writer moved the version → 409 via `assertVersionMatched`.
   * Returns the list of changed field names for the emitted event.
   */
  async update(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      actorPrincipalId: string;
      fields: UpdateOrganizationFields;
    },
  ): Promise<string[]> {
    const changed = Object.keys(input.fields).filter(
      (k) => input.fields[k as keyof UpdateOrganizationFields] !== undefined,
    );
    const rows = await tx
      .update(organizations)
      .set({
        ...input.fields,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(
        and(
          eq(organizations.id, input.id),
          eq(organizations.version, input.expectedVersion),
          isNull(organizations.deletedAt),
        ),
      )
      .returning({ id: organizations.id });
    assertVersionMatched(rows.length);
    return changed;
  }

  /**
   * Explicit, audited consent toggle (§3.16 — consent defaults to false and never changes as a
   * side effect of an ordinary update). Optimistic-locked like {@link update}.
   */
  async setDataProcessingConsent(
    tx: Tx,
    input: { id: string; expectedVersion: number; consent: boolean; actorPrincipalId: string },
  ): Promise<void> {
    const rows = await tx
      .update(organizations)
      .set({
        dataProcessingConsent: input.consent,
        version: nextVersion(input.expectedVersion),
        updatedAt: new Date(),
        updatedBy: input.actorPrincipalId,
      })
      .where(
        and(
          eq(organizations.id, input.id),
          eq(organizations.version, input.expectedVersion),
          isNull(organizations.deletedAt),
        ),
      )
      .returning({ id: organizations.id });
    assertVersionMatched(rows.length);
  }
}
