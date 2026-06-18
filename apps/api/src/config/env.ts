import { z } from 'zod';

/** Coerce a "true"/"false" env string to boolean (z.coerce.boolean treats any non-empty
 * string as true — a footgun for flags like AUTH_COOKIE_SECURE=false). */
const boolFromString = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

/**
 * Environment configuration, validated with Zod at the edge (CLAUDE.md §2). Invalid env
 * fails fast at boot. Defaults target the local docker-compose Postgres + Redis.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1).default('postgres://agentos:agentos@localhost:5432/agentos'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    LOG_LEVEL: z.string().default('info'),
    OTEL_SERVICE_NAME: z.string().default('agentos-api'),

    // --- Access-token signing (EdDSA / Ed25519 via jose, CLAUDE.md §2/§3.11) ---
    // Keys come from a secret manager in real environments; absent in dev/test, an ephemeral
    // keypair is generated at boot (see ed25519-key.provider.ts). Production requires both.
    JWT_PRIVATE_KEY: z.string().optional(), // PKCS8 PEM (Ed25519)
    JWT_PUBLIC_KEY: z.string().optional(), // SPKI PEM (Ed25519)
    JWT_KID: z.string().default('dev'),
    JWT_ISSUER: z.string().default('agentos'),
    JWT_AUDIENCE: z.string().default('agentos-api'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min (§3.11)
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30 days

    // --- Argon2id password hashing (OWASP defaults, CLAUDE.md §3.13) ---
    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

    // --- Login brute-force throttle (Redis, CLAUDE.md §6 — full rate-limit is Phase 6) ---
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),

    // --- Refresh-token cookie (browser clients; API/mobile use the JSON body) ---
    AUTH_COOKIE_NAME: z.string().default('agentos_refresh'),
    AUTH_COOKIE_SECURE: boolFromString(true),
    AUTH_COOKIE_DOMAIN: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && (!config.JWT_PRIVATE_KEY || !config.JWT_PUBLIC_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production',
        path: ['JWT_PRIVATE_KEY'],
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

/** DI token for the validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
