import 'reflect-metadata';
import {
  Module,
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';
import type { DomainEventEnvelope } from '@agentos/contracts';
import {
  IDENTITY_AUTH_CONFIG,
  type IdentityAuthConfig,
} from './infrastructure/identity-auth.config';
import { JWT_KEYS, buildJwtKeys, AccessTokenService } from './infrastructure/ed25519-token-service';
import { PasswordHasher, Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { PrincipalsRepository } from './infrastructure/principals.repository';
import { UsersRepository } from './infrastructure/users.repository';
import { IdentitiesRepository } from './infrastructure/identities.repository';
import { SessionsRepository } from './infrastructure/sessions.repository';
import { AuthMembershipRepository } from './infrastructure/auth-membership.repository';
import { SessionIssuer } from './application/session-issuer';
import { UserRegistrar } from './application/user-registrar';
import { LoginService } from './application/login.service';
import { RefreshService } from './application/refresh.service';
import { LogoutService } from './application/logout.service';
import { SessionsService } from './application/sessions.service';
import { AuthController } from './interfaces/auth.controller';
import { AccessTokenGuard } from './interfaces/access-token.guard';

export interface IdentityModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (...args: never[]) => IdentityAuthConfig | Promise<IdentityAuthConfig>;
}

/**
 * The `identity` bounded context (CLAUDE.md §1) — principals, users, identities, sessions, and
 * the authentication operations (login / refresh / logout / sessions). Registration lives at
 * the host because it provisions a tenant across contexts; this module exposes the public
 * services that host composes (`UserRegistrar`, `PasswordHasher`, `SessionIssuer`,
 * `AccessTokenService`). Config is injected via `forRootAsync` so the module never imports the
 * app composition root (§17).
 */
@Module({})
export class IdentityModule {
  static forRootAsync(options: IdentityModuleAsyncOptions): DynamicModule {
    return {
      module: IdentityModule,
      imports: options.imports ?? [],
      controllers: [AuthController],
      providers: [
        { provide: IDENTITY_AUTH_CONFIG, useFactory: options.useFactory, inject: options.inject ?? [] },
        { provide: JWT_KEYS, useFactory: buildJwtKeys, inject: [IDENTITY_AUTH_CONFIG] },
        { provide: PasswordHasher, useClass: Argon2PasswordHasher },
        AccessTokenService,
        SessionIssuer,
        PrincipalsRepository,
        UsersRepository,
        IdentitiesRepository,
        SessionsRepository,
        AuthMembershipRepository,
        LoginService,
        RefreshService,
        LogoutService,
        SessionsService,
        UserRegistrar,
        AccessTokenGuard,
      ],
      exports: [
        IDENTITY_AUTH_CONFIG,
        PasswordHasher,
        AccessTokenService,
        UserRegistrar,
        SessionIssuer,
      ],
    };
  }
}

export { passwordSchema } from './domain/password';
export { IDENTITY_AUTH_CONFIG } from './infrastructure/identity-auth.config';
export type { IdentityAuthConfig } from './infrastructure/identity-auth.config';
export { PasswordHasher } from './infrastructure/argon2-password-hasher';
export { AccessTokenService } from './infrastructure/ed25519-token-service';
export type { VerifiedAccessToken } from './infrastructure/ed25519-token-service';
export { UserRegistrar } from './application/user-registrar';
export type { RegisteredUser } from './application/user-registrar';
export { SessionIssuer } from './application/session-issuer';
export type { IssuedTokens, ClientMeta } from './application/session-issuer';
export type { AuthContext, RequestWithAuth } from './interfaces/auth-context';
export { AccessTokenGuard, requireAuth } from './interfaces/access-token.guard';
export {
  deliverTokens,
  clearRefreshCookie,
  clientMetaFrom,
  correlationIdFrom,
  extractRefreshToken,
  AUTH_COOKIE_PATH,
} from './interfaces/auth-http';
export type {
  AuthRequestView,
  CookieCapableReply,
  TokenResponseBody,
  TokenDelivery,
} from './interfaces/auth-http';
export type { DomainEventEnvelope };
