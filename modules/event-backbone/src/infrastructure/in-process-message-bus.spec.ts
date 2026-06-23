import { describe, it, expect, vi } from 'vitest';
import type { DeliveredEvent } from '@agentos/message-bus';
import { InProcessMessageBus } from './in-process-message-bus';

function event(type: string): DeliveredEvent {
  return {
    id: `evt-${type}`,
    type,
    version: 1,
    aggregateType: 'Thing',
    aggregateId: 'agg-1',
    organizationId: 'org-1',
    workspaceId: null,
    actorPrincipalId: 'prin-1',
    correlationId: 'corr-1',
    causationId: null,
    occurredAt: new Date(),
    payload: {},
  };
}

describe('InProcessMessageBus', () => {
  it('delivers to type-specific and wildcard subscribers, not to unrelated ones', async () => {
    const bus = new InProcessMessageBus();
    const onUser = vi.fn().mockResolvedValue(undefined);
    const onAll = vi.fn().mockResolvedValue(undefined);
    const onOther = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('UserRegistered', onUser);
    bus.subscribe('*', onAll);
    bus.subscribe('RoleCreated', onOther);

    const e = event('UserRegistered');
    await bus.publish(e);

    expect(onUser).toHaveBeenCalledWith(e);
    expect(onAll).toHaveBeenCalledWith(e);
    expect(onOther).not.toHaveBeenCalled();
  });

  it('rejects when any handler throws, so the relay can retry (at-least-once)', async () => {
    const bus = new InProcessMessageBus();
    bus.subscribe('*', () => Promise.reject(new Error('consumer down')));
    await expect(bus.publish(event('UserRegistered'))).rejects.toThrow('consumer down');
  });
});
