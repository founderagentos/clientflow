import { Injectable } from '@nestjs/common';
import type { Tx } from '@agentos/persistence-kernel';
import { organizations } from '../infrastructure/organizations.schema';

export interface ProvisionPersonalOrganizationInput {
  organizationId: string;
  name: string;
  slug: string;
  actorPrincipalId: string;
}

export interface ProvisionedOrganization {
  organizationId: string;
  slug: string;
  name: string;
}

/**
 * Public provisioning service (CLAUDE.md §3.1) — inserts the tenant-root organization inside
 * the caller's transaction. `data_processing_consent` is left at its schema default of `false`
 * (deny-by-default, §16, gate §7.4). The caller pre-generates `organizationId` and sets it as
 * the RLS tenant key before this runs, so the insert satisfies the `organizations` policy
 * (`id = app.current_organization_id`).
 */
@Injectable()
export class OrganizationProvisioner {
  async provisionPersonal(
    tx: Tx,
    input: ProvisionPersonalOrganizationInput,
  ): Promise<ProvisionedOrganization> {
    await tx.insert(organizations).values({
      id: input.organizationId,
      slug: input.slug,
      name: input.name,
      createdBy: input.actorPrincipalId,
      updatedBy: input.actorPrincipalId,
    });
    return { organizationId: input.organizationId, slug: input.slug, name: input.name };
  }
}
