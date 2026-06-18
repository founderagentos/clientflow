import { describe, it, expect } from 'vitest';
import { domainEventEnvelopeSchema } from './event-envelope';

const base = {
  id: '0190c000-0000-7000-8000-000000000001',
  type: 'UserRegistered',
  version: 1,
  occurredAt: '2026-06-15T00:00:00.000Z',
  organizationId: '0190c000-0000-7000-8000-000000000002',
  workspaceId: '0190c000-0000-7000-8000-000000000003',
  actorPrincipalId: '0190c000-0000-7000-8000-000000000004',
  correlationId: 'req_1',
  causationId: null,
  payload: { userId: '0190c000-0000-7000-8000-000000000004' },
};

describe('domainEventEnvelope', () => {
  it('accepts a fully tenant-stamped event', () => {
    expect(domainEventEnvelopeSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an event missing tenant context (organizationId)', () => {
    const { organizationId: _omitted, ...withoutOrg } = base;
    expect(domainEventEnvelopeSchema.safeParse(withoutOrg).success).toBe(false);
  });

  it('allows org-scoped events (null workspaceId)', () => {
    expect(domainEventEnvelopeSchema.safeParse({ ...base, workspaceId: null }).success).toBe(true);
  });
});
