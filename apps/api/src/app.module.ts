import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loggerModuleParams } from '@agentos/observability';
import { EventBackboneModule } from '@agentos/event-backbone';
import { OrganizationModule } from '@agentos/organization';
import { WorkspaceModule } from '@agentos/workspace';
import { AccessModule } from '@agentos/access';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './persistence/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { ProblemDetailsExceptionFilter } from './http/problem-details.filter';
import { TenantContextMiddleware } from './http/tenant-context.middleware';
import { LoginThrottleInterceptor } from './http/login-throttle.interceptor';
import { IdentityFeature } from './onboarding/identity.feature';
import { OnboardingModule } from './onboarding/onboarding.module';
import { TenancyModule } from './tenancy/tenancy.module';

/**
 * Composition root. Phase 2 wires the auth core: the identity module (login/refresh/logout/
 * sessions), the cross-context onboarding slice (register), the global outbox, plus the
 * tenant-context middleware and login throttle. Bounded-context modules are imported here.
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
    AccessModule,
    OnboardingModule,
    TenancyModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoginThrottleInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
