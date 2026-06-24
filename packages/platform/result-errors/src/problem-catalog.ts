import { problemType } from './errors';

/**
 * One entry per problem type in the platform taxonomy. This is the single source of truth the
 * OpenAPI builder (§6) and the generated docs consume — every {@link AppError} subclass has a
 * matching entry here, enforced by a test. `title` describes the problem *type* (not an
 * occurrence); occurrence-specific text goes in `detail` at throw time.
 */
export interface ProblemTypeDescriptor {
  /** Stable machine-readable code (== AppError.code). */
  readonly code: string;
  /** HTTP status the type maps to (== AppError.status). */
  readonly status: number;
  /** Short human-readable summary of the type. */
  readonly title: string;
  /** Stable problem-type URI (urn:agentos:problem:<code>). */
  readonly type: string;
}

function entry(code: string, status: number, title: string): ProblemTypeDescriptor {
  return { code, status, title, type: problemType(code) };
}

/** The complete problem taxonomy, ordered by status. */
export const PROBLEM_CATALOG: readonly ProblemTypeDescriptor[] = [
  entry('bad_request', 400, 'Bad request'),
  entry('unauthenticated', 401, 'Authentication required'),
  entry('forbidden', 403, 'Permission denied'),
  entry('tenant_context_missing', 403, 'Tenant context missing'),
  entry('not_found', 404, 'Resource not found'),
  entry('conflict', 409, 'Conflict'),
  entry('version_conflict', 409, 'Version conflict'),
  entry('request_in_progress', 409, 'Request in progress'),
  entry('payload_too_large', 413, 'Payload too large'),
  entry('unsupported_media_type', 415, 'Unsupported media type'),
  entry('validation_failed', 422, 'Validation failed'),
  entry('idempotency_key_reused', 422, 'Idempotency key reused'),
  entry('rate_limited', 429, 'Too many requests'),
  entry('internal_error', 500, 'Internal server error'),
  entry('service_unavailable', 503, 'Service temporarily unavailable'),
] as const;

/** Lookup a problem descriptor by its stable code. */
export function problemByCode(code: string): ProblemTypeDescriptor | undefined {
  return PROBLEM_CATALOG.find((p) => p.code === code);
}
