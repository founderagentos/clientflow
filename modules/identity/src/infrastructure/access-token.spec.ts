import { describe, it, expect } from 'vitest';
import { decodeJwt } from 'jose';
import { passwordSchema } from '../domain/password';
import { mintRefreshToken, hashRefreshToken, refreshTokenMatches } from '../domain/refresh-token';
import { AccessTokenService, buildJwtKeys } from './ed25519-token-service';
import type { IdentityAuthConfig } from './identity-auth.config';

const config: IdentityAuthConfig = {
  argon2: { memoryKib: 19_456, timeCost: 2, parallelism: 1 },
  jwt: { kid: 'test', issuer: 'agentos', audience: 'agentos-api', accessTtlSeconds: 900 },
  refreshTtlSeconds: 2_592_000,
  cookie: { name: 'c', secure: false },
};

describe('access token (EdDSA)', () => {
  it('carries no permission/role claims (gate §7.5) and round-trips', async () => {
    const svc = new AccessTokenService(await buildJwtKeys(config), config);
    const { token } = await svc.issue({
      principalId: 'p1',
      organizationId: 'o1',
      workspaceId: null,
      tokenVersion: 0,
    });

    const claims = decodeJwt(token);
    expect(claims.sub).toBe('p1');
    expect(claims.org).toBe('o1');
    expect(claims.token_version).toBe(0);
    for (const forbidden of ['permissions', 'roles', 'scope', 'scopes', 'perms']) {
      expect(claims[forbidden]).toBeUndefined();
    }

    const verified = await svc.verify(token);
    expect(verified.principalId).toBe('p1');
  });

  it('rejects a tampered/foreign token', async () => {
    const svc = new AccessTokenService(await buildJwtKeys(config), config);
    await expect(svc.verify('not.a.jwt')).rejects.toThrow();
  });
});

describe('refresh token', () => {
  it('mints unique, high-entropy tokens with a stable, matchable hash', () => {
    const a = mintRefreshToken();
    const b = mintRefreshToken();
    expect(a).not.toBe(b);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(refreshTokenMatches(a, hashRefreshToken(a))).toBe(true);
    expect(refreshTokenMatches(a, hashRefreshToken(b))).toBe(false);
  });
});

describe('password policy', () => {
  it('rejects short / blank and accepts a strong password', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('            ').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });
});
