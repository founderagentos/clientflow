import { describe, it, expect } from 'vitest';
import {
  NotFoundError,
  ForbiddenError,
  OptimisticLockError,
  ValidationError,
  TenantContextMissingError,
  isAppError,
} from './errors';

describe('error taxonomy', () => {
  it('maps to RFC 9457 problem details', () => {
    const pd = new NotFoundError('Lead not found').toProblemDetails('/api/v1/leads/123');
    expect(pd).toMatchObject({
      type: 'urn:agentos:problem:not_found',
      status: 404,
      code: 'not_found',
      title: 'Lead not found',
      instance: '/api/v1/leads/123',
    });
  });

  it('keeps stable status/code per error type', () => {
    expect(new ForbiddenError().status).toBe(403);
    expect(new TenantContextMissingError().code).toBe('tenant_context_missing');
    expect(new OptimisticLockError().status).toBe(409);
    expect(new OptimisticLockError().code).toBe('version_conflict');
  });

  it('embeds field errors in validation problems', () => {
    const pd = new ValidationError('Invalid', { email: ['must be an email'] }).toProblemDetails();
    expect(pd.errors).toEqual({ email: ['must be an email'] });
  });

  it('recognizes app errors', () => {
    expect(isAppError(new ForbiddenError())).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
