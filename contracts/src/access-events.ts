import { z } from 'zod';

/**
 * Access / authorization domain events (CLAUDE.md §3.14/§3.15) — PastTense, emitted to the
 * transactional outbox in the same DB transaction as the state change they describe. Each is
 * wrapped in the platform `domainEventEnvelopeSchema` (which carries organization_id,
 * workspace_id, actor_principal_id, correlation_id, causation_id). Payloads carry only
 * non-sensitive identifiers — never API-key plaintext or token hashes (§3.20).
 *
 * `RoleAssigned` is canonically defined here (the `access` context owns role assignment); the
 * identity registration and tenancy invitation-acceptance paths emit this same event type.
 */
export const AccessEventType = {
  RoleCreated: 'RoleCreated',
  RoleUpdated: 'RoleUpdated',
  RoleDeleted: 'RoleDeleted',
  RoleAssigned: 'RoleAssigned',
  RoleRevoked: 'RoleRevoked',
  PermissionGranted: 'PermissionGranted',
  PermissionRevoked: 'PermissionRevoked',
  ServiceAccountCreated: 'ServiceAccountCreated',
  ApiKeyIssued: 'ApiKeyIssued',
  ApiKeyRevoked: 'ApiKeyRevoked',
} as const;

export type AccessEventType = (typeof AccessEventType)[keyof typeof AccessEventType];

/** Aggregate-type labels for the outbox `aggregate_type` column. */
export const AccessAggregateType = {
  Role: 'Role',
  Membership: 'Membership',
  ServiceAccount: 'ServiceAccount',
  ApiKey: 'ApiKey',
} as const;

export const RoleScope = {
  Organization: 'organization',
  Workspace: 'workspace',
} as const;

export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];

export const roleCreatedPayload = z.object({
  roleId: z.string(),
  name: z.string(),
  scope: z.enum([RoleScope.Organization, RoleScope.Workspace]),
});

export const roleUpdatedPayload = z.object({
  roleId: z.string(),
  changed: z.array(z.string()),
});

export const roleDeletedPayload = z.object({
  roleId: z.string(),
});

export const roleAssignedPayload = z.object({
  membershipId: z.string(),
  roleId: z.string(),
  principalId: z.string(),
  roleName: z.string(),
});

export const roleRevokedPayload = z.object({
  membershipId: z.string(),
  roleId: z.string(),
  principalId: z.string(),
});

export const permissionGrantedPayload = z.object({
  roleId: z.string(),
  permissionKey: z.string(),
});

export const permissionRevokedPayload = z.object({
  roleId: z.string(),
  permissionKey: z.string(),
});

export const serviceAccountCreatedPayload = z.object({
  serviceAccountId: z.string(),
  name: z.string(),
});

export const apiKeyIssuedPayload = z.object({
  apiKeyId: z.string(),
  serviceAccountId: z.string(),
  expiresAt: z.string().datetime().nullable(),
});

export const apiKeyRevokedPayload = z.object({
  apiKeyId: z.string(),
  serviceAccountId: z.string(),
});

export type RoleCreatedPayload = z.infer<typeof roleCreatedPayload>;
export type RoleUpdatedPayload = z.infer<typeof roleUpdatedPayload>;
export type RoleDeletedPayload = z.infer<typeof roleDeletedPayload>;
export type RoleAssignedPayload = z.infer<typeof roleAssignedPayload>;
export type RoleRevokedPayload = z.infer<typeof roleRevokedPayload>;
export type PermissionGrantedPayload = z.infer<typeof permissionGrantedPayload>;
export type PermissionRevokedPayload = z.infer<typeof permissionRevokedPayload>;
export type ServiceAccountCreatedPayload = z.infer<typeof serviceAccountCreatedPayload>;
export type ApiKeyIssuedPayload = z.infer<typeof apiKeyIssuedPayload>;
export type ApiKeyRevokedPayload = z.infer<typeof apiKeyRevokedPayload>;
