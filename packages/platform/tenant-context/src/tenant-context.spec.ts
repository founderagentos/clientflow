import { describe, it, expect } from 'vitest';
import { TenantContextMissingError } from '@agentos/result-errors';
import {
  runWithTenantContext,
  getTenantContext,
  requireTenantContext,
  type TenantContext,
} from './tenant-context';

const ctx: TenantContext = {
  organizationId: '0190c000-0000-7000-8000-000000000001',
  workspaceId: '0190c000-0000-7000-8000-000000000002',
  principal: { id: '0190c000-0000-7000-8000-000000000003', type: 'user' },
  correlationId: 'req_test',
};

describe('tenant-context', () => {
  it('binds context within the async scope', () => {
    runWithTenantContext(ctx, () => {
      expect(getTenantContext()).toBe(ctx);
      expect(requireTenantContext().organizationId).toBe(ctx.organizationId);
    });
  });

  it('has no context outside a bound scope', () => {
    expect(getTenantContext()).toBeUndefined();
  });

  it('denies (throws) when required context is absent — never defaults', () => {
    expect(() => requireTenantContext()).toThrow(TenantContextMissingError);
  });

  it('supports org-scoped operations (null workspace)', () => {
    runWithTenantContext({ ...ctx, workspaceId: null }, () => {
      expect(requireTenantContext().workspaceId).toBeNull();
    });
  });
});
