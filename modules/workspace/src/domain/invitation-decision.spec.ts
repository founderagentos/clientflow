import { describe, it, expect } from 'vitest';
import { decideInvitation, type InvitationState } from './invitation-decision';

const now = new Date('2026-06-19T00:00:00Z');
const future = new Date(now.getTime() + 60_000);
const past = new Date(now.getTime() - 60_000);

const pending = (expiresAt: Date): InvitationState => ({ status: 'pending', expiresAt });

describe('decideInvitation', () => {
  it('treats a missing invitation as invalid (→ 404, no existence leak)', () => {
    expect(decideInvitation(null, now).kind).toBe('invalid');
  });

  it('accepts a pending, unexpired invitation', () => {
    expect(decideInvitation(pending(future), now).kind).toBe('acceptable');
  });

  it('flags an expired invitation', () => {
    expect(decideInvitation(pending(past), now).kind).toBe('expired');
  });

  it('treats the exact expiry instant as expired (boundary)', () => {
    expect(decideInvitation(pending(now), now).kind).toBe('expired');
  });

  it('treats already-accepted / revoked / expired statuses as invalid', () => {
    for (const status of ['accepted', 'revoked', 'expired'] as const) {
      expect(decideInvitation({ status, expiresAt: future }, now).kind).toBe('invalid');
    }
  });
});
