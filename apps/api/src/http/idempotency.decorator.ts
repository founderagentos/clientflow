import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key marking a route exempt from idempotency replay. */
export const SKIP_IDEMPOTENCY = 'skip_idempotency';

/**
 * Exempts a route from idempotency handling even when an Idempotency-Key is sent — for endpoints
 * where replaying a cached response would be wrong (e.g. token issuance). Auth routes are skipped by
 * path regardless, since their controllers live in a module that cannot import this decorator.
 */
export const SkipIdempotency = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_IDEMPOTENCY, true);
