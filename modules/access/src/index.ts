import 'reflect-metadata';
import {
  Module,
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { DomainEventEnvelope } from '@agentos/contracts';
import { RoleAssigner } from './application/role-assigner';
import { RolesRepository } from './infrastructure/roles.repository';
import { PermissionsRepository } from './infrastructure/permissions.repository';
import { RolePermissionsRepository } from './infrastructure/role-permissions.repository';
import { MembershipRolesRepository } from './infrastructure/membership-roles.repository';
import { ACCESS_CACHE_REDIS } from './infrastructure/access-cache-redis.token';
import { RedisPermissionCache } from './infrastructure/redis-permission-cache';
import { PERMISSION_CACHE } from './application/permission-cache.port';
import { PolicyDecisionPoint } from './application/policy-decision-point';
import { RoleService } from './application/role.service';
import { PermissionCatalogService } from './application/permission-catalog.service';
import { RolePermissionService } from './application/role-permission.service';
import { RoleAssignmentService } from './application/role-assignment.service';

export interface AccessModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: FactoryProvider['inject'];
  /** Supplies the shared ioredis client backing the permission cache (host wires this). */
  useRedisFactory: (...args: never[]) => Redis | Promise<Redis>;
}

const PROVIDERS = [
  RolesRepository,
  PermissionsRepository,
  RolePermissionsRepository,
  MembershipRolesRepository,
  PolicyDecisionPoint,
  RoleService,
  PermissionCatalogService,
  RolePermissionService,
  RoleAssignmentService,
  RoleAssigner,
  { provide: PERMISSION_CACHE, useClass: RedisPermissionCache },
];

const EXPORTS = [
  PolicyDecisionPoint,
  RoleService,
  PermissionCatalogService,
  RolePermissionService,
  RoleAssignmentService,
  RoleAssigner,
  RolesRepository,
  PermissionsRepository,
  PERMISSION_CACHE,
];

/**
 * The `access` bounded context (CLAUDE.md §1) — roles, permissions, role↔permission mappings,
 * role assignment, and the centralized default-deny PDP with its Redis permission cache. The
 * host supplies the Redis client via `forRootAsync` so this library never imports the app
 * composition root (§17). Modules integrate only via `@agentos/contracts` and domain events.
 */
@Module({})
export class AccessModule {
  static forRootAsync(options: AccessModuleAsyncOptions): DynamicModule {
    return {
      module: AccessModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: ACCESS_CACHE_REDIS,
          useFactory: options.useRedisFactory,
          inject: options.inject ?? [],
        },
        ...PROVIDERS,
      ],
      exports: EXPORTS,
    };
  }
}

export { RoleAssigner } from './application/role-assigner';
export type { AssignOwnerRoleInput, AssignRoleInput, AssignedRole } from './application/role-assigner';
export { PolicyDecisionPoint } from './application/policy-decision-point';
export { RoleService } from './application/role.service';
export { PermissionCatalogService } from './application/permission-catalog.service';
export { RolePermissionService } from './application/role-permission.service';
export type { PermissionMapResult } from './application/role-permission.service';
export { RoleAssignmentService } from './application/role-assignment.service';
export { RolesRepository } from './infrastructure/roles.repository';
export type { RoleRow } from './infrastructure/roles.repository';
export { PermissionsRepository } from './infrastructure/permissions.repository';
export type { PermissionRow } from './infrastructure/permissions.repository';
export { PERMISSION_CACHE } from './application/permission-cache.port';
export type { PermissionCachePort } from './application/permission-cache.port';
export type { AuthorizationQuery, Decision, PrincipalRef } from './domain/decision';
export { parsePermissionKey, isPermissionKey } from './domain/permission-key';
export type { PermissionKey } from './domain/permission-key';
export type { DomainEventEnvelope };
