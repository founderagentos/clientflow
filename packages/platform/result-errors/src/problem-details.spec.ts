import { describe, it, expect } from 'vitest';
import { PROBLEM_CATALOG } from './problem-catalog';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  IdempotencyKeyConflictError,
  InternalError,
  NotFoundError,
  OptimisticLockError,
  PayloadTooLargeError,
  RequestInProgressError,
  ServiceUnavailableError,
  TenantContextMissingError,
  TooManyRequestsError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
  ValidationError,
} from './errors';

/** One instance of every concrete AppError subclass. */
const ALL_ERRORS: AppError[] = [
  new BadRequestError(),
  new UnauthenticatedError(),
  new ForbiddenError(),
  new TenantContextMissingError(),
  new NotFoundError(),
  new ConflictError(),
  new OptimisticLockError(),
  new RequestInProgressError(),
  new PayloadTooLargeError(),
  new UnsupportedMediaTypeError(),
  new ValidationError(),
  new IdempotencyKeyConflictError(),
  new TooManyRequestsError(),
  new InternalError(),
  new ServiceUnavailableError(),
];

describe('problem taxonomy', () => {
  it('renders RFC 9457 problem details with stable type/status/code for every error', () => {
    for (const err of ALL_ERRORS) {
      const pd = err.toProblemDetails('/api/v1/x');
      expect(pd.status).toBe(err.status);
      expect(pd.code).toBe(err.code);
      expect(pd.type).toBe(`urn:agentos:problem:${err.code}`);
      expect(pd.instance).toBe('/api/v1/x');
    }
  });

  it('has a catalog entry whose status matches each error class (no drift)', () => {
    for (const err of ALL_ERRORS) {
      const entry = PROBLEM_CATALOG.find((p) => p.code === err.code);
      expect(entry, `missing catalog entry for ${err.code}`).toBeDefined();
      expect(entry?.status).toBe(err.status);
      expect(entry?.type).toBe(err.type);
    }
  });

  it('has no catalog entry without a backing error class', () => {
    const errorCodes = new Set(ALL_ERRORS.map((e) => e.code));
    for (const entry of PROBLEM_CATALOG) {
      expect(errorCodes.has(entry.code), `orphan catalog entry ${entry.code}`).toBe(true);
    }
  });

  it('keeps every catalog code unique', () => {
    const codes = PROBLEM_CATALOG.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
