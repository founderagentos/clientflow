import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DATABASE, withTenantTransaction, type Database } from '@agentos/persistence-kernel';
import { MESSAGE_BUS, type DeliveredEvent, type MessageBus } from '@agentos/message-bus';
import { TenancyEventType } from '@agentos/contracts';
import { DefaultPipelineRepository } from '../infrastructure/default-pipeline.repository';

/**
 * Seeds the default Pipeline + stages when a workspace is created (RFC-002 §2.2, Phase 1). CRM is a
 * tenant of the kernel and the kernel knows nothing about CRM (CLAUDE.md §17), so rather than the
 * workspace provisioner calling into CRM, this consumer subscribes to the kernel's `WorkspaceCreated`
 * event — exactly mirroring the audit consumer. Subscribed at module init, before the relay starts,
 * so no committed workspace-creation is missed.
 *
 * The workspace id is read from the event **payload** (registration emits `WorkspaceCreated` at org
 * scope, so the envelope's `workspaceId` is null while the payload carries it). The seed runs under
 * the event's tenant context via `withTenantTransaction`, satisfying RLS as `app_user`, and is
 * idempotent under at-least-once delivery (repository pre-check + partial unique).
 */
@Injectable()
export class DefaultPipelineProvisioner implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MESSAGE_BUS) private readonly bus: MessageBus,
    private readonly repository: DefaultPipelineRepository,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(TenancyEventType.WorkspaceCreated, (event) => this.handle(event));
  }

  async handle(event: DeliveredEvent): Promise<void> {
    const workspaceId =
      typeof event.payload.workspaceId === 'string' ? event.payload.workspaceId : null;
    if (!workspaceId) {
      return;
    }
    await withTenantTransaction(
      this.db,
      { organizationId: event.organizationId, workspaceId },
      (tx) =>
        this.repository.seedDefault(tx, {
          organizationId: event.organizationId,
          workspaceId,
          actorPrincipalId: event.actorPrincipalId,
        }),
    );
  }
}
