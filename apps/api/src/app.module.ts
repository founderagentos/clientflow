import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loggerModuleParams } from '@agentos/observability';
import { EventBackboneModule } from '@agentos/event-backbone';
import { OrganizationModule } from '@agentos/organization';
import { WorkspaceModule } from '@agentos/workspace';
import { CrmAuthorizationModule } from './crm/crm-authorization.module';
import { CrmHostModule } from './crm/crm-host.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './persistence/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { ProblemDetailsExceptionFilter } from './http/problem-details.filter';
import { TenantContextMiddleware } from './http/tenant-context.middleware';
import { ApiKeyAuthMiddleware } from './http/api-key-auth.middleware';
import { AccessHostModule } from './access/access.module';
import { AuditHostModule } from './audit/audit.module';
import { LoginThrottleInterceptor } from './http/login-throttle.interceptor';
import { RateLimitGuard } from './http/rate-limit.guard';
import { IdempotencyInterceptor } from './http/idempotency.interceptor';
import { IdempotencyStore } from './http/idempotency-store';
import { IdentityFeature } from './onboarding/identity.feature';
import { OnboardingModule } from './onboarding/onboarding.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { OpenApiModule } from './openapi/openapi.module';

/**
 * Composition root. Wires the auth core (identity: login/refresh/logout/sessions), the
 * cross-context onboarding slice (register), tenancy, access, and — Phase 5 — the event backbone
 * (the global outbox plus the MessageBus + relay, provided by EventBackboneModule) and the audit
 * slice (the event-driven append-only writer + the guarded query API). Bounded-context modules are
 * imported here; the tenant-context middleware and login throttle wrap every route.
 */
@Module({
  imports: [
    LoggerModule.forRoot(loggerModuleParams()),
    ConfigModule,
    DatabaseModule,
    RedisModule,
    // Phase 5: the global AUTHORIZATION port binding, registered early so every downstream CRM
    // module (instantiated later) sees the global token.
    CrmAuthorizationModule,
    EventBackboneModule,
    IdentityFeature,
    OrganizationModule,
    WorkspaceModule,
    AccessHostModule,
    AuditHostModule,
    OnboardingModule,
    TenancyModule,
    // CRM Core (RFC-002) — the host slice that composes the account + deal modules (activating the
    // deal DefaultPipelineProvisioner) and provides the cross-context orchestrators (Phase 3:
    // AccountDeletionOrchestrator). Phase-4 conversion/import orchestrators and Phase-6 controllers
    // join here.
    CrmHostModule,
    HealthModule,
    OpenApiModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
    // Edge guard runs before route permission guards — reject rate-limited requests before any PDP/DB.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: LoginThrottleInterceptor },
    IdempotencyStore,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // API-key auth runs first so a service-account context is bound before the bearer middleware.
    consumer.apply(ApiKeyAuthMiddleware, TenantContextMiddleware).forRoutes('*');
  }
}
