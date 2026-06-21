import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@agentos/result-errors';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { TenancyAggregateType, TenancyEventType } from '@agentos/contracts';
import {
  OrganizationsRepository,
  type OrganizationRow,
  type UpdateOrganizationFields,
} from '../infrastructure/organizations.repository';

/** The acting principal + active tenant context, resolved by the host from the access token. */
export interface OrganizationActor {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  correlationId: string;
}

/**
 * Organization management for the active tenant (CLAUDE.md §6 Phase 3). Operations are scoped to
 * the caller's active organization — RLS pins the tenant, so there is no `:id` lookup across
 * organizations (cross-org listing is the deferred context-switch slice). Every method runs in a
 * tenant transaction and emits its PastTense event to the outbox in the same unit of work
 * (§3.14). `data_processing_consent` is mutated only through {@link setDataProcessingConsent},
 * never as a side effect of {@link update} (§3.16).
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async getCurrent(actor: OrganizationActor): Promise<OrganizationRow> {
    return withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      async (tx) => {
        const org = await this.organizations.findById(tx, actor.organizationId);
        if (!org) {
          throw new NotFoundError('Organization not found');
        }
        return org;
      },
    );
  }

  async update(
    actor: OrganizationActor,
    expectedVersion: number,
    fields: UpdateOrganizationFields,
  ): Promise<OrganizationRow> {
    return withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      async (tx) => {
        const changed = await this.organizations.update(tx, {
          id: actor.organizationId,
          expectedVersion,
          actorPrincipalId: actor.principalId,
          fields,
        });
        await this.outbox.append(tx, {
          organizationId: actor.organizationId,
          workspaceId: null,
          actorPrincipalId: actor.principalId,
          correlationId: actor.correlationId,
          causationId: null,
          aggregateType: TenancyAggregateType.Organization,
          aggregateId: actor.organizationId,
          type: TenancyEventType.OrganizationUpdated,
          payload: { organizationId: actor.organizationId, changed },
        });
        const updated = await this.organizations.findById(tx, actor.organizationId);
        if (!updated) {
          throw new NotFoundError('Organization not found');
        }
        return updated;
      },
    );
  }

  async setDataProcessingConsent(
    actor: OrganizationActor,
    expectedVersion: number,
    consent: boolean,
  ): Promise<OrganizationRow> {
    return withTenantTransaction(
      this.db,
      { organizationId: actor.organizationId, workspaceId: actor.workspaceId },
      async (tx) => {
        await this.organizations.setDataProcessingConsent(tx, {
          id: actor.organizationId,
          expectedVersion,
          consent,
          actorPrincipalId: actor.principalId,
        });
        await this.outbox.append(tx, {
          organizationId: actor.organizationId,
          workspaceId: null,
          actorPrincipalId: actor.principalId,
          correlationId: actor.correlationId,
          causationId: null,
          aggregateType: TenancyAggregateType.Organization,
          aggregateId: actor.organizationId,
          type: TenancyEventType.DataProcessingConsentChanged,
          payload: { organizationId: actor.organizationId, consent },
        });
        const updated = await this.organizations.findById(tx, actor.organizationId);
        if (!updated) {
          throw new NotFoundError('Organization not found');
        }
        return updated;
      },
    );
  }
}
