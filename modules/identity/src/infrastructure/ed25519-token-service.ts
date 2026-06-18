import { Inject, Injectable } from '@nestjs/common';
import {
  SignJWT,
  jwtVerify,
  importPKCS8,
  importSPKI,
  generateKeyPair,
  type KeyLike,
} from 'jose';
import { newId } from '@agentos/identifier';
import { UnauthenticatedError } from '@agentos/result-errors';
import { IDENTITY_AUTH_CONFIG, type IdentityAuthConfig } from './identity-auth.config';

const EDDSA = 'EdDSA';

export interface JwtKeys {
  privateKey: KeyLike;
  publicKey: KeyLike;
  kid: string;
}

/** DI token for the resolved Ed25519 signing/verification keypair. */
export const JWT_KEYS = Symbol('JWT_KEYS');

/**
 * Resolve the Ed25519 keypair: from configured PEM (production, injected from a secret
 * manager) or, when absent in dev/test, an ephemeral in-memory keypair generated at boot so
 * local development needs no key setup (CLAUDE.md §2 — production requires real keys, enforced
 * by the env schema's production refinement).
 */
export async function buildJwtKeys(config: IdentityAuthConfig): Promise<JwtKeys> {
  if (config.jwt.privateKeyPem && config.jwt.publicKeyPem) {
    const [privateKey, publicKey] = await Promise.all([
      importPKCS8(config.jwt.privateKeyPem, EDDSA),
      importSPKI(config.jwt.publicKeyPem, EDDSA),
    ]);
    return { privateKey, publicKey, kid: config.jwt.kid };
  }
  const { privateKey, publicKey } = await generateKeyPair(EDDSA, { extractable: false });
  return { privateKey, publicKey, kid: config.jwt.kid };
}

export interface AccessTokenClaims {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  tokenVersion: number;
}

export interface VerifiedAccessToken {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  tokenVersion: number;
  jti: string;
}

/**
 * Mints and verifies the short-lived stateless access token (CLAUDE.md §3.11). EdDSA so any
 * service can verify with the public key alone (no shared secret, no DB hit). Claims are
 * deliberately minimal — `sub` (principal), active `org`/`ws`, and `token_version`. It carries
 * **no permissions or roles** (gate §7.5): authorization is resolved server-side by the PDP
 * (Phase 4) to avoid the stale-permission problem (§3.10).
 */
@Injectable()
export class AccessTokenService {
  constructor(
    @Inject(JWT_KEYS) private readonly keys: JwtKeys,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  async issue(
    claims: AccessTokenClaims,
  ): Promise<{ token: string; jti: string; expiresInSeconds: number }> {
    const jti = newId();
    const ttl = this.config.jwt.accessTtlSeconds;
    const token = await new SignJWT({
      org: claims.organizationId,
      ws: claims.workspaceId,
      token_version: claims.tokenVersion,
    })
      .setProtectedHeader({ alg: EDDSA, kid: this.keys.kid })
      .setSubject(claims.principalId)
      .setIssuer(this.config.jwt.issuer)
      .setAudience(this.config.jwt.audience)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .setJti(jti)
      .sign(this.keys.privateKey);
    return { token, jti, expiresInSeconds: ttl };
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.keys.publicKey, {
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
        algorithms: [EDDSA],
      });
      const principalId = payload.sub;
      const organizationId = payload.org;
      const tokenVersion = payload.token_version;
      const workspaceId = payload.ws;
      if (
        typeof principalId !== 'string' ||
        typeof organizationId !== 'string' ||
        typeof tokenVersion !== 'number' ||
        !(workspaceId === null || typeof workspaceId === 'string')
      ) {
        throw new UnauthenticatedError('Malformed access token');
      }
      return {
        principalId,
        organizationId,
        workspaceId,
        tokenVersion,
        jti: typeof payload.jti === 'string' ? payload.jti : '',
      };
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        throw error;
      }
      throw new UnauthenticatedError('Invalid or expired access token');
    }
  }
}
