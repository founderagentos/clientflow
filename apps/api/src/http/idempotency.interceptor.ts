import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, from, of, switchMap, tap, throwError } from 'rxjs';
import { createHash } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import {
  BadRequestError,
  IdempotencyKeyConflictError,
  RequestInProgressError,
} from '@agentos/result-errors';
import { getTenantContext } from '@agentos/tenant-context';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { IdempotencyStore, type IdempotencyDecision } from './idempotency-store';
import { SKIP_IDEMPOTENCY } from './idempotency.decorator';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,255}$/;
const REPLAYED_HEADER = 'idempotency-replayed';

/**
 * Honours the `Idempotency-Key` header on mutating requests (CLAUDE.md §6). An interceptor — not a
 * middleware — because replay requires capturing the handler's response, which middleware cannot do.
 * Keys are tenant-scoped; an in-flight duplicate returns 409, a key reused with a different body
 * returns 422, and a completed request is replayed with an `Idempotency-Replayed` header. Fails OPEN
 * on Redis errors (the request runs un-deduplicated) so the store never takes the API down.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.config.IDEMPOTENCY_ENABLED || context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (!MUTATING_METHODS.has(req.method)) {
      return next.handle();
    }
    const idemKey = req.headers['idempotency-key'];
    if (typeof idemKey !== 'string' || idemKey.length === 0) {
      return next.handle();
    }
    const path = (req.url ?? '').split('?')[0] ?? '';
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_IDEMPOTENCY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || path.startsWith('/api/v1/auth/')) {
      return next.handle();
    }
    if (!IDEMPOTENCY_KEY_RE.test(idemKey)) {
      return throwError(
        () => new BadRequestError('Invalid Idempotency-Key header', { detail: 'Must be 1–255 of [A-Za-z0-9._:-].' }),
      );
    }

    const key = this.buildKey(req, idemKey);
    const fingerprint = this.fingerprint(req);
    const ttl = this.config.IDEMPOTENCY_TTL_SECONDS;

    return from(this.decide(key, fingerprint, ttl)).pipe(
      switchMap((decision) => this.apply(decision, key, fingerprint, ttl, reply, next)),
    );
  }

  /** Claim the key; fail OPEN (run the handler un-deduplicated) on any store error. */
  private async decide(
    key: string,
    fingerprint: string,
    ttl: number,
  ): Promise<IdempotencyDecision | { kind: 'failopen' }> {
    try {
      return await this.store.begin(key, fingerprint, ttl);
    } catch (err) {
      this.logger.warn({ err }, 'Idempotency store unavailable; processing request un-deduplicated');
      return { kind: 'failopen' };
    }
  }

  private apply(
    decision: IdempotencyDecision | { kind: 'failopen' },
    key: string,
    fingerprint: string,
    ttl: number,
    reply: FastifyReply,
    next: CallHandler,
  ): Observable<unknown> {
    switch (decision.kind) {
      case 'mismatch':
        return throwError(() => new IdempotencyKeyConflictError());
      case 'in_progress':
        return throwError(() => new RequestInProgressError());
      case 'replay':
        void reply.status(decision.status).header(REPLAYED_HEADER, 'true');
        return of(decision.body);
      case 'failopen':
        return next.handle();
      case 'claimed':
        return next.handle().pipe(
          tap({
            next: (body) => {
              const status = reply.statusCode || 200;
              void this.store.complete(key, fingerprint, status, body, ttl).catch((err: unknown) => {
                this.logger.warn({ err }, 'Failed to persist idempotent response');
              });
            },
            error: () => {
              // Handler failed — release the lock so the client may retry. Only successes are cached.
              void this.store.release(key).catch(() => undefined);
            },
          }),
        );
    }
  }

  /** Tenant-scoped key: per organization + principal when authenticated, else per source IP. */
  private buildKey(req: FastifyRequest, idemKey: string): string {
    const ctx = getTenantContext();
    if (ctx) {
      return `idem:${ctx.organizationId}:${ctx.principal.id}:${idemKey}`;
    }
    return `idem:anon:${req.ip || 'unknown'}:${idemKey}`;
  }

  /** Bind the key to the exact request so reuse with a different payload is rejected. */
  private fingerprint(req: FastifyRequest): string {
    const body = req.body === undefined ? 'null' : JSON.stringify(req.body);
    return createHash('sha256').update(`${req.method}\n${req.url ?? ''}\n${body}`).digest('hex');
  }
}
