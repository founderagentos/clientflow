import { z } from 'zod';

/**
 * Identity / onboarding domain events (CLAUDE.md §3.14/§3.15) — PastTense, emitted to the
 * transactional outbox in the same DB transaction as the state change they describe. Each is
 * wrapped in the platform `domainEventEnvelopeSchema` (which carries organization_id,
 * workspace_id, actor_principal_id, correlation_id, causation_id). Payloads carry only
 * non-sensitive identifiers — never passwords, token plaintext, or hashes (§3.20).
 */
export const IdentityEventType = {
  UserRegistered: 'UserRegistered',
  OrganizationProvisioned: 'OrganizationProvisioned',
  WorkspaceCreated: 'WorkspaceCreated',
  OwnerMembershipGranted: 'OwnerMembershipGranted',
  UserAuthenticated: 'UserAuthenticated',
  SessionCreated: 'SessionCreated',
  TokenRefreshed: 'TokenRefreshed',
  SessionRevoked: 'SessionRevoked',
  RefreshTokenReuseDetected: 'RefreshTokenReuseDetected',
} as const;

export type IdentityEventType = (typeof IdentityEventType)[keyof typeof IdentityEventType];

/** Aggregate-type labels for the outbox `aggregate_type` column. */
export const IdentityAggregateType = {
  User: 'User',
  Organization: 'Organization',
  Workspace: 'Workspace',
  Membership: 'Membership',
  Session: 'Session',
} as const;

export const userRegisteredPayload = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
});

export const organizationProvisionedPayload = z.object({
  organizationId: z.string(),
  slug: z.string(),
  name: z.string(),
});

export const workspaceCreatedPayload = z.object({
  workspaceId: z.string(),
  slug: z.string(),
  name: z.string(),
});

export const ownerMembershipGrantedPayload = z.object({
  membershipId: z.string(),
  principalId: z.string(),
});

export const userAuthenticatedPayload = z.object({
  principalId: z.string(),
  method: z.literal('password'),
});

export const sessionCreatedPayload = z.object({
  sessionId: z.string(),
  familyId: z.string(),
});

export const tokenRefreshedPayload = z.object({
  sessionId: z.string(),
  familyId: z.string(),
  previousSessionId: z.string(),
});

/** Why a session ended — distinguishes routine rotation/logout from theft response. */
export const SessionRevocationReason = {
  Rotated: 'rotated',
  LoggedOut: 'logged_out',
  ReuseDetected: 'reuse_detected',
  TokenVersionBumped: 'token_version_bumped',
} as const;

export type SessionRevocationReason =
  (typeof SessionRevocationReason)[keyof typeof SessionRevocationReason];

export const sessionRevokedPayload = z.object({
  sessionId: z.string(),
  familyId: z.string(),
  reason: z.enum([
    SessionRevocationReason.Rotated,
    SessionRevocationReason.LoggedOut,
    SessionRevocationReason.ReuseDetected,
    SessionRevocationReason.TokenVersionBumped,
  ]),
});

export const refreshTokenReuseDetectedPayload = z.object({
  familyId: z.string(),
  presentedSessionId: z.string(),
  revokedSessionCount: z.number().int().nonnegative(),
});

export type UserRegisteredPayload = z.infer<typeof userRegisteredPayload>;
export type OrganizationProvisionedPayload = z.infer<typeof organizationProvisionedPayload>;
export type WorkspaceCreatedPayload = z.infer<typeof workspaceCreatedPayload>;
export type OwnerMembershipGrantedPayload = z.infer<typeof ownerMembershipGrantedPayload>;
export type UserAuthenticatedPayload = z.infer<typeof userAuthenticatedPayload>;
export type SessionCreatedPayload = z.infer<typeof sessionCreatedPayload>;
export type TokenRefreshedPayload = z.infer<typeof tokenRefreshedPayload>;
export type SessionRevokedPayload = z.infer<typeof sessionRevokedPayload>;
export type RefreshTokenReuseDetectedPayload = z.infer<typeof refreshTokenReuseDetectedPayload>;
