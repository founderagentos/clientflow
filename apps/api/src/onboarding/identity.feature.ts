import { IdentityModule, type IdentityAuthConfig } from '@agentos/identity';
import { APP_CONFIG, type AppConfig } from '../config/env';

/** Maps the validated env into the identity module's config shape (CLAUDE.md §2). */
export function toIdentityAuthConfig(config: AppConfig): IdentityAuthConfig {
  return {
    argon2: {
      memoryKib: config.ARGON2_MEMORY_KIB,
      timeCost: config.ARGON2_TIME_COST,
      parallelism: config.ARGON2_PARALLELISM,
    },
    jwt: {
      privateKeyPem: config.JWT_PRIVATE_KEY,
      publicKeyPem: config.JWT_PUBLIC_KEY,
      kid: config.JWT_KID,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    },
    refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
    cookie: {
      name: config.AUTH_COOKIE_NAME,
      secure: config.AUTH_COOKIE_SECURE,
      domain: config.AUTH_COOKIE_DOMAIN,
    },
  };
}

/**
 * The configured identity module — built once and imported by reference wherever its public
 * services are needed (AppModule for the AuthController; OnboardingModule for the registration
 * orchestrator). Importing the same DynamicModule reference lets Nest dedupe to one instance.
 */
export const IdentityFeature = IdentityModule.forRootAsync({
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => toIdentityAuthConfig(config),
});
