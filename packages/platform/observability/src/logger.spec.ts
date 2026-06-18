import { describe, it, expect } from 'vitest';
import { pino } from 'pino';
import { runWithTenantContext } from '@agentos/tenant-context';
import { createBaseLoggerOptions, REDACT_PATHS } from './logger';

// A disabled logger to satisfy the pino mixin signature (mergeObject, level, logger).
const logger = pino({ enabled: false });

describe('logger', () => {
  it('redacts secret/token fields', () => {
    expect(REDACT_PATHS).toContain('*.password');
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('*.refreshToken');
  });

  it('mixin is empty with no tenant context bound', () => {
    const opts = createBaseLoggerOptions();
    expect(opts.mixin?.({}, 0, logger)).toEqual({});
  });

  it('mixin injects tenant + correlation identifiers when context is bound', () => {
    const opts = createBaseLoggerOptions();
    runWithTenantContext(
      {
        organizationId: 'org-1',
        workspaceId: 'ws-1',
        principal: { id: 'p-1', type: 'user' },
        correlationId: 'req-1',
      },
      () => {
        expect(opts.mixin?.({}, 0, logger)).toEqual({
          organization_id: 'org-1',
          workspace_id: 'ws-1',
          principal_id: 'p-1',
          correlation_id: 'req-1',
        });
      },
    );
  });
});
