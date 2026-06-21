import { describe, it, expect } from 'vitest';
import {
  mintInvitationToken,
  hashInvitationToken,
  invitationTokenMatches,
} from './invitation-token';

describe('invitation token', () => {
  it('mints a high-entropy, unique opaque token each call', () => {
    const a = mintInvitationToken();
    const b = mintInvitationToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(40); // 32 bytes base64url
  });

  it('hashes deterministically and never returns the plaintext', () => {
    const token = mintInvitationToken();
    expect(hashInvitationToken(token)).toEqual(hashInvitationToken(token));
    expect(hashInvitationToken(token)).not.toEqual(token);
  });

  it('matches a token against its own hash (round-trip)', () => {
    const token = mintInvitationToken();
    expect(invitationTokenMatches(token, hashInvitationToken(token))).toBe(true);
  });

  it('rejects a wrong token (constant-time compare)', () => {
    const token = mintInvitationToken();
    expect(invitationTokenMatches(mintInvitationToken(), hashInvitationToken(token))).toBe(false);
  });
});
