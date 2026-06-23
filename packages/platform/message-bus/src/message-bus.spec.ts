import { describe, it, expect } from 'vitest';
import { MESSAGE_BUS, ALL_EVENTS } from './message-bus';

describe('message-bus port', () => {
  it('exposes a unique DI token symbol', () => {
    expect(typeof MESSAGE_BUS).toBe('symbol');
    expect(MESSAGE_BUS.description).toBe('agentos.message-bus');
  });

  it('uses "*" as the subscribe-to-all key', () => {
    expect(ALL_EVENTS).toBe('*');
  });
});
