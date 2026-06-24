import type { ProblemDetails } from './problem-details';

/** URN namespace for problem types: urn:agentos:problem:<code>. */
export const PROBLEM_TYPE_BASE = 'urn:agentos:problem:';

/** Build the stable problem-type URI for a code (the same value AppError.type returns). */
export function problemType(code: string): string {
  return `${PROBLEM_TYPE_BASE}${code}`;
}

export interface AppErrorOptions {
  detail?: string;
  meta?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Base of the platform error taxonomy. Every error maps deterministically to an
 * RFC 9457 Problem Details document (CLAUDE.md §2/§3.9).
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  readonly detail: string | undefined;
  readonly meta: Record<string, unknown> | undefined;

  constructor(message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.detail = options?.detail;
    this.meta = options?.meta;
  }

  get type(): string {
    return `${PROBLEM_TYPE_BASE}${this.code}`;
  }

  toProblemDetails(instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.message,
      status: this.status,
      code: this.code,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      ...(instance !== undefined ? { instance } : {}),
      ...(this.meta ?? {}),
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** 401 — no/invalid authentication. */
export class UnauthenticatedError extends AppError {
  readonly status: number = 401;
  readonly code: string = 'unauthenticated';
  constructor(message = 'Authentication required', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 403 — authenticated but not permitted (default-deny PDP outcome, CLAUDE.md §3.9). */
export class ForbiddenError extends AppError {
  readonly status: number = 403;
  readonly code: string = 'forbidden';
  constructor(message = 'Permission denied', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 403 — request reached the app with no resolved tenant; denied, never defaulted (§3.7). */
export class TenantContextMissingError extends AppError {
  readonly status: number = 403;
  readonly code: string = 'tenant_context_missing';
  constructor(message = 'No tenant context resolved for this request', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 404 — resource not found. Also used for cross-tenant references (never 403, §3.8). */
export class NotFoundError extends AppError {
  readonly status: number = 404;
  readonly code: string = 'not_found';
  constructor(message = 'Resource not found', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 409 — state conflict (e.g. uniqueness). */
export class ConflictError extends AppError {
  readonly status: number = 409;
  readonly code: string = 'conflict';
  constructor(message = 'Conflict', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 409 — optimistic-lock version mismatch (§3.4 — writes assert expected version). */
export class OptimisticLockError extends ConflictError {
  override readonly code: string = 'version_conflict';
  constructor(message = 'Resource was modified by another writer', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 422 — input failed validation. */
export class ValidationError extends AppError {
  readonly status: number = 422;
  readonly code: string = 'validation_failed';
  constructor(
    message = 'Validation failed',
    errors?: Record<string, string[]>,
    options?: AppErrorOptions,
  ) {
    super(message, {
      ...options,
      meta: { ...(options?.meta ?? {}), ...(errors ? { errors } : {}) },
    });
  }
}

/** 429 — rate limit exceeded (§6 edge hardening). */
export class TooManyRequestsError extends AppError {
  readonly status: number = 429;
  readonly code: string = 'rate_limited';
  constructor(message = 'Too many requests', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 400 — malformed request the validator cannot express (e.g. a bad Idempotency-Key header). */
export class BadRequestError extends AppError {
  readonly status: number = 400;
  readonly code: string = 'bad_request';
  constructor(message = 'Bad request', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 413 — request body exceeds the configured limit (§6 edge hardening). */
export class PayloadTooLargeError extends AppError {
  readonly status: number = 413;
  readonly code: string = 'payload_too_large';
  constructor(message = 'Request body too large', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 415 — unsupported or missing Content-Type. */
export class UnsupportedMediaTypeError extends AppError {
  readonly status: number = 415;
  readonly code: string = 'unsupported_media_type';
  constructor(message = 'Unsupported media type', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 422 — same Idempotency-Key replayed with a different request payload (§6). */
export class IdempotencyKeyConflictError extends AppError {
  readonly status: number = 422;
  readonly code: string = 'idempotency_key_reused';
  constructor(
    message = 'Idempotency-Key was reused with a different request',
    options?: AppErrorOptions,
  ) {
    super(message, options);
  }
}

/** 409 — a request with the same Idempotency-Key is still in flight (§6). */
export class RequestInProgressError extends AppError {
  readonly status: number = 409;
  readonly code: string = 'request_in_progress';
  constructor(message = 'A request with this Idempotency-Key is already in progress', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 503 — a dependency is unavailable; the request can be retried. */
export class ServiceUnavailableError extends AppError {
  readonly status: number = 503;
  readonly code: string = 'service_unavailable';
  constructor(message = 'Service temporarily unavailable', options?: AppErrorOptions) {
    super(message, options);
  }
}

/** 500 — unexpected internal failure. */
export class InternalError extends AppError {
  readonly status: number = 500;
  readonly code: string = 'internal_error';
  constructor(message = 'Internal server error', options?: AppErrorOptions) {
    super(message, options);
  }
}
