/**
 * Configuration the identity module needs, injected by the composition root (the app reads it
 * from the validated env — CLAUDE.md §2). Defined here, not imported from the app, so the
 * module stays inside its Nx boundary (§17): the app provides the value via
 * `IdentityModule.forRootAsync`.
 */
export interface IdentityAuthConfig {
  argon2: {
    memoryKib: number;
    timeCost: number;
    parallelism: number;
  };
  jwt: {
    /** Ed25519 PKCS8 PEM. Absent in dev/test → an ephemeral keypair is generated at boot. */
    privateKeyPem?: string | undefined;
    /** Ed25519 SPKI PEM. */
    publicKeyPem?: string | undefined;
    kid: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
  };
  refreshTtlSeconds: number;
  cookie: {
    name: string;
    secure: boolean;
    domain?: string | undefined;
  };
}

/** DI token for {@link IdentityAuthConfig}. */
export const IDENTITY_AUTH_CONFIG = Symbol('IDENTITY_AUTH_CONFIG');
