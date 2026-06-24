import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key marking a route exempt from rate limiting. */
export const SKIP_RATE_LIMIT = 'skip_rate_limit';

/** Reflector metadata key carrying per-route rate-limit overrides. */
export const RATE_LIMIT_OVERRIDE = 'rate_limit_override';

/** Per-layer override of the configured limits (e.g. stricter on auth endpoints). */
export interface RateLimitOverride {
  /** Override per-IP { max, windowSeconds }. */
  ip?: { max: number; windowSeconds: number };
  /** Override per-principal { max, windowSeconds }. */
  principal?: { max: number; windowSeconds: number };
  /** Override per-organization { max, windowSeconds }. */
  org?: { max: number; windowSeconds: number };
}

/**
 * Exempts a route (or controller) from the global {@link RateLimitGuard} — for liveness probes and
 * the OpenAPI document, which must answer even under load (CLAUDE.md §6).
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT, true);

/** Tightens or loosens the rate limit for a specific route, layer by layer. */
export const RateLimit = (override: RateLimitOverride): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_OVERRIDE, override);
