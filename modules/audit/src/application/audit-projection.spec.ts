import { describe, it, expect } from 'vitest';
import { AccessEventType, IdentityEventType } from '@agentos/contracts';
import type { DeliveredEvent } from '@agentos/message-bus';
import { classify } from './audit-projection';

function event(overrides: Partial<DeliveredEvent>): DeliveredEvent {
  return {
    id: 'evt-1',
    type: IdentityEventType.UserRegistered,
    version: 1,
    aggregateType: 'User',
    aggregateId: 'agg-1',
    organizationId: 'org-1',
    workspaceId: null,
    actorPrincipalId: 'prin-1',
    correlationId: 'corr-1',
    causationId: null,
    occurredAt: new Date(),
    payload: {},
    ...overrides,
  };
}

describe('classify', () => {
  it('maps a known event to its deliberate action/resource and defaults result to success', () => {
    expect(classify(event({ type: IdentityEventType.UserRegistered }))).toEqual({
      action: 'register',
      resourceType: 'user',
      result: 'success',
    });
    expect(classify(event({ type: AccessEventType.RoleAssigned }))).toEqual({
      action: 'assign',
      resourceType: 'membership',
      result: 'success',
    });
  });

  it('classifies a security-failure event with result=failure', () => {
    expect(classify(event({ type: IdentityEventType.RefreshTokenReuseDetected }))).toEqual({
      action: 'reuse_detected',
      resourceType: 'session',
      result: 'failure',
    });
  });

  it('still audits an unmapped event — action=type, resource derived from the aggregate', () => {
    expect(classify(event({ type: 'SomethingNew', aggregateType: 'Widget' }))).toEqual({
      action: 'SomethingNew',
      resourceType: 'widget',
      result: 'success',
    });
  });
});
