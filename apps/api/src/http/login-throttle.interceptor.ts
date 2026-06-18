import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable, from, switchMap, tap } from 'rxjs';
import type Redis from 'ioredis';
import { TooManyRequestsError, UnauthenticatedError } from '@agentos/result-errors';
import { REDIS } from '../redis/redis.module';
import { APP_CONFIG, type AppConfig } from '../config/env';

interface ThrottledRequest {
  method?: string;
  url?: string;
  ip?: string;
  body?: { email?: unknown };
}

/**
 * Per-IP + per-account login throttle (CLAUDE.md §6 auth hardening — full three-layer rate
 * limiting is Phase 6). Locks out after LOGIN_MAX_ATTEMPTS failed attempts for LOGIN_LOCKOUT
 * seconds; a successful login resets the counters. Only touches POST /auth/login.
 */
@Injectable()
export class LoginThrottleInterceptor implements NestInterceptor {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ThrottledRequest>();
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (req.method !== 'POST' || !path.endsWith('/auth/login')) {
      return next.handle();
    }
    const ip = req.ip ?? 'unknown';
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'unknown';
    const keys = [`login:ip:${ip}`, `login:email:${email}`];

    return from(this.assertNotLocked(keys)).pipe(
      switchMap(() =>
        next.handle().pipe(
          tap({
            next: () => void this.reset(keys),
            error: (err: unknown) => {
              if (err instanceof UnauthenticatedError) {
                void this.recordFailure(keys);
              }
            },
          }),
        ),
      ),
    );
  }

  private async assertNotLocked(keys: string[]): Promise<void> {
    const counts = await Promise.all(keys.map((key) => this.redis.get(key)));
    if (counts.some((count) => count !== null && Number(count) >= this.config.LOGIN_MAX_ATTEMPTS)) {
      throw new TooManyRequestsError('Too many login attempts; try again later');
    }
  }

  private async recordFailure(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        const count = await this.redis.incr(key);
        if (count === 1) {
          await this.redis.expire(key, this.config.LOGIN_LOCKOUT_SECONDS);
        }
      }),
    );
  }

  private async reset(keys: string[]): Promise<void> {
    await this.redis.del(...keys);
  }
}
