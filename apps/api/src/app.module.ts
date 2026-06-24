import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loggerModuleParams } from '@agentos/observability';
import { EventBackboneModule } from '@agentos/event-backbone';
import { OrganizationModule } from '@agentos/organization';
import { WorkspaceModule } from '@agentos/workspace';
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
    EventBackboneModule,
    IdentityFeature,
    OrganizationModule,
    WorkspaceModule,
    AccessHostModule,
    AuditHostModule,
    OnboardingModule,
    TenancyModule,
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
