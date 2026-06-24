import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { TooManyRequestsError } from '@agentos/result-errors';
import { getTenantContext } from '@agentos/tenant-context';
import { REDIS } from '../redis/redis.module';
import { APP_CONFIG, type AppConfig } from '../config/env';
import {
  RATE_LIMIT_OVERRIDE,
  SKIP_RATE_LIMIT,
  type RateLimitOverride,
} from './rate-limit.decorator';

interface Layer {
  key: string;
  max: number;
  windowSeconds: number;
}

interface Decision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/**
 * Atomic sliding-window-counter across N layers. Checks every layer and increments the current
 * window of each ONLY if all pass, so a deny on one layer never over-counts the others. Returns the
 * decision for the most-constraining layer (smallest remaining) for header reporting.
 *
 * KEYS = base key per layer; ARGV = now_ms, n, then (limit, window_ms) per layer.
 * Reply = { allowed(0|1), limit, remaining, resetMs } for the binding layer.
 */
const SLIDING_WINDOW_LUA = `
local now = tonumber(ARGV[1])
local n = tonumber(ARGV[2])
local anyDeny = false
local denyLimit = 0
local denyResetMs = 0
local bestRemaining = nil
local bestLimit = 0
local bestResetMs = 0
local curKeys = {}
local windows = {}
for i = 1, n do
  local base = KEYS[i]
  local limit = tonumber(ARGV[1 + i * 2])
  local window = tonumber(ARGV[2 + i * 2])
  local curWin = math.floor(now / window)
  local elapsed = now - curWin * window
  local curKey = base .. ':' .. curWin
  local prevKey = base .. ':' .. (curWin - 1)
  local cur = tonumber(redis.call('GET', curKey) or '0')
  local prev = tonumber(redis.call('GET', prevKey) or '0')
  local weight = (window - elapsed) / window
  local estimate = prev * weight + cur
  local resetMs = window - elapsed
  curKeys[i] = curKey
  windows[i] = window
  if estimate + 1 > limit then
    anyDeny = true
    denyLimit = limit
    if resetMs > denyResetMs then denyResetMs = resetMs end
  else
    local remaining = limit - (estimate + 1)
    if bestRemaining == nil or remaining < bestRemaining then
      bestRemaining = remaining
      bestLimit = limit
      bestResetMs = resetMs
    end
  end
end
if anyDeny then
  return {0, denyLimit, 0, denyResetMs}
end
for i = 1, n do
  redis.call('INCR', curKeys[i])
  redis.call('PEXPIRE', curKeys[i], windows[i] * 2)
end
if bestRemaining == nil then bestRemaining = 0 end
return {1, bestLimit, bestRemaining, bestResetMs}
`;

/**
 * Three-layer request rate limiting (CLAUDE.md §6): per-IP (covers unauthenticated traffic),
 * per-principal and per-organization (when a TenantContext is bound). A global guard runs after the
 * auth/tenant-context middleware but before the route's permission guard and handler — so it rejects
 * before any PDP/DB work, yet can read the resolved principal/org from the ALS.
 *
 * Fails OPEN on Redis errors, matching the access permission cache: availability over a false 429.
 * Emits IETF RateLimit-* headers on every response and Retry-After on a 429.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.RATE_LIMIT_ENABLED || context.getType() !== 'http') {
      return true;
    }
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const override =
      this.reflector.getAllAndOverride<RateLimitOverride>(RATE_LIMIT_OVERRIDE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};

    const layers = this.buildLayers(req, override);
    if (layers.length === 0) {
      return true;
    }

    let decision: Decision;
    try {
      decision = await this.evaluate(layers);
    } catch (err) {
      // Fail open — a rate-limit store outage must not take the API down.
      this.logger.warn({ err }, 'Rate-limit check failed; allowing request (fail-open)');
      return true;
    }

    void reply.header('RateLimit-Limit', String(decision.limit));
    void reply.header('RateLimit-Remaining', String(Math.max(0, decision.remaining)));
    void reply.header('RateLimit-Reset', String(decision.resetSeconds));

    if (!decision.allowed) {
      void reply.header('Retry-After', String(decision.resetSeconds));
      throw new TooManyRequestsError('Rate limit exceeded', {
        detail: 'Too many requests; retry after the period indicated by Retry-After.',
      });
    }
    return true;
  }

  private buildLayers(req: FastifyRequest, override: RateLimitOverride): Layer[] {
    const layers: Layer[] = [];
    const ip = req.ip || 'unknown';
    layers.push({
      key: `rl:ip:${ip}`,
      max: override.ip?.max ?? this.config.RATE_LIMIT_IP_MAX,
      windowSeconds: override.ip?.windowSeconds ?? this.config.RATE_LIMIT_IP_WINDOW_SECONDS,
    });

    const ctx = getTenantContext();
    if (ctx) {
      layers.push({
        key: `rl:prin:${ctx.principal.id}`,
        max: override.principal?.max ?? this.config.RATE_LIMIT_PRINCIPAL_MAX,
        windowSeconds:
          override.principal?.windowSeconds ?? this.config.RATE_LIMIT_PRINCIPAL_WINDOW_SECONDS,
      });
      layers.push({
        key: `rl:org:${ctx.organizationId}`,
        max: override.org?.max ?? this.config.RATE_LIMIT_ORG_MAX,
        windowSeconds: override.org?.windowSeconds ?? this.config.RATE_LIMIT_ORG_WINDOW_SECONDS,
      });
    }
    return layers;
  }

  private async evaluate(layers: Layer[]): Promise<Decision> {
    const keys = layers.map((l) => l.key);
    const args: (string | number)[] = [Date.now(), layers.length];
    for (const l of layers) {
      args.push(l.max, l.windowSeconds * 1000);
    }
    const raw = (await this.redis.eval(
      SLIDING_WINDOW_LUA,
      keys.length,
      ...keys,
      ...args,
    )) as [number, number, number, number];
    const [allowed, limit, remaining, resetMs] = raw;
    return {
      allowed: allowed === 1,
      limit,
      remaining,
      resetSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }
}
