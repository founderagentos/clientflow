import { Module } from '@nestjs/common';
import { WorkspaceModule } from '@agentos/workspace';
import { IdentityFeature } from '../onboarding/identity.feature';
import { AccessFeature } from './access.feature';
import { RequirePermissionGuard } from './require-permission.guard';
import { RoleManagementOrchestrator } from './role-management.orchestrator';
import { RoleAssignmentOrchestrator } from './role-assignment.orchestrator';
import { ServiceAccountOrchestrator } from './service-account.orchestrator';
import { ApiKeyOrchestrator } from './api-key.orchestrator';
import { RolesController } from './roles.controller';
import { PermissionsController } from './permissions.controller';
import { RoleAssignmentsController } from './role-assignments.controller';
import { ServiceAccountsController } from './service-accounts.controller';
import { ApiKeysController } from './api-keys.controller';
import { PermissionCacheInvalidationConsumer } from './permission-cache-invalidation.consumer';

/**
 * Host access slice (CLAUDE.md §6 Phase 4) — the HTTP surface for roles, permissions, role
 * assignment, service accounts, and API keys, plus the PDP-backed permission guard and the
 * cross-context orchestrators. Hosted here (type:app) because it composes identity (service
 * accounts / API keys), workspace (memberships), and access (PDP / roles) — a bounded-context
 * module may not import another's internals (§17). Phase 5 adds the event-driven permission-cache
 * invalidation backup (§3.10), which consumes role/membership events off the MessageBus.
 */
@Module({
  imports: [AccessFeature, IdentityFeature, WorkspaceModule],
  controllers: [
    RolesController,
    PermissionsController,
    RoleAssignmentsController,
    ServiceAccountsController,
    ApiKeysController,
  ],
  providers: [
    RequirePermissionGuard,
    RoleManagementOrchestrator,
    RoleAssignmentOrchestrator,
    ServiceAccountOrchestrator,
    ApiKeyOrchestrator,
    PermissionCacheInvalidationConsumer,
  ],
})
export class AccessHostModule {}
