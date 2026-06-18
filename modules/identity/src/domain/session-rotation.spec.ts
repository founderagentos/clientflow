import { describe, it, expect } from 'vitest';
import { decideRefresh, type SessionSnapshot } from './session-rotation';

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);
const base: SessionSnapshot = {
  id: 's1',
  familyId: 'f1',
  principalId: 'p1',
  revokedAt: null,
  expiresAt: future,
};

describe('decideRefresh', () => {
  it('denies an unknown token', () => {
    expect(decideRefresh(null, new Date()).kind).toBe('not_found');
  });

  it('rotates a live, unconsumed session', () => {
    expect(decideRefresh(base, new Date()).kind).toBe('rotate');
  });

  it('flags reuse when the token was already consumed/revoked', () => {
    const decision = decideRefresh({ ...base, revokedAt: past }, new Date());
    expect(decision.kind).toBe('reuse_detected');
  });

  it('checks revocation before expiry (replay surfaces as theft, not benign expiry)', () => {
    const decision = decideRefresh({ ...base, revokedAt: past, expiresAt: past }, new Date());
    expect(decision.kind).toBe('reuse_detected');
  });

  it('rejects an expired (but never consumed) token', () => {
    expect(decideRefresh({ ...base, expiresAt: past }, new Date()).kind).toBe('expired');
  });
});
