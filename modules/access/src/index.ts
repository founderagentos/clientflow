import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { RoleAssigner } from './application/role-assigner';

/**
 * The `access` bounded context (CLAUDE.md §1) — roles, permissions, assignments, and (Phase 4)
 * the PDP. Phase 2 exposes the role-assignment provisioning service the host registration
 * orchestrator composes. Modules integrate only via `@agentos/contracts` and domain events (§17).
 */
@Module({
  providers: [RoleAssigner],
  exports: [RoleAssigner],
})
export class AccessModule {}

export { RoleAssigner } from './application/role-assigner';
export type {
  AssignOwnerRoleInput,
  AssignRoleInput,
  AssignedRole,
} from './application/role-assigner';
export type { DomainEventEnvelope };
