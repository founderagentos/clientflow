import { describe, expect, it } from 'vitest';
import { decide, type AuthorizationQuery } from './decision';

const baseQuery: AuthorizationQuery = {
  principal: { id: 'p1', type: 'user' },
  organizationId: 'org1',
  workspaceId: 'ws1',
  permission: 'role.create',
};

describe('decide (default-deny)', () => {
  it('denies when the effective set is empty', () => {
    expect(decide(baseQuery, new Set())).toEqual({ effect: 'deny', reason: 'no_grant' });
  });

  it('denies when the permission is not granted', () => {
    expect(decide(baseQuery, new Set(['role.read']))).toEqual({ effect: 'deny', reason: 'no_grant' });
  });

  it('allows when the permission is in the effective set', () => {
    expect(decide(baseQuery, new Set(['role.read', 'role.create']))).toEqual({ effect: 'allow' });
  });

  it('authorizes a service-account principal identically to a human', () => {
    const saQuery: AuthorizationQuery = { ...baseQuery, principal: { id: 'sa1', type: 'service_account' } };
    expect(decide(saQuery, new Set(['role.create']))).toEqual({ effect: 'allow' });
  });
});
