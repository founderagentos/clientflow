import { z } from 'zod';

/**
 * Tenancy domain events (CLAUDE.md §3.14/§3.15) — PastTense, emitted to the transactional
 * outbox in the same DB transaction as the state change they describe. Each is wrapped in the
 * platform `domainEventEnvelopeSchema` (which carries organization_id, workspace_id,
 * actor_principal_id, correlation_id, causation_id). Payloads carry only non-sensitive
 * identifiers — never invitation token plaintext or hashes (§3.20).
 *
 * Covers the Phase 3 lifecycle: organization updates, workspace CRUD, membership management,
 * and the invite → accept → membership flow. `WorkspaceCreated` reuses the canonical event type
 * string already emitted by registration (contracts/identity-events.ts) so consumers see one
 * workspace-creation type regardless of origin.
 */
export const TenancyEventType = {
  OrganizationUpdated: 'OrganizationUpdated',
  DataProcessingConsentChanged: 'DataProcessingConsentChanged',
  WorkspaceCreated: 'WorkspaceCreated',
  WorkspaceUpdated: 'WorkspaceUpdated',
  WorkspaceArchived: 'WorkspaceArchived',
  MemberInvited: 'MemberInvited',
  InvitationAccepted: 'InvitationAccepted',
  InvitationRevoked: 'InvitationRevoked',
  MembershipCreated: 'MembershipCreated',
  MembershipRoleChanged: 'MembershipRoleChanged',
  MemberRemoved: 'MemberRemoved',
} as const;

export type TenancyEventType = (typeof TenancyEventType)[keyof typeof TenancyEventType];

/** Aggregate-type labels for the outbox `aggregate_type` column. */
export const TenancyAggregateType = {
  Organization: 'Organization',
  Workspace: 'Workspace',
  Membership: 'Membership',
  Invitation: 'Invitation',
} as const;

export const organizationUpdatedPayload = z.object({
  organizationId: z.string(),
  /** Names of the fields that changed in this update (e.g. ['name', 'homeRegion']). */
  changed: z.array(z.string()),
});

export const dataProcessingConsentChangedPayload = z.object({
  organizationId: z.string(),
  consent: z.boolean(),
});

export const workspaceCreatedTenancyPayload = z.object({
  workspaceId: z.string(),
  parentWorkspaceId: z.string().nullable(),
  slug: z.string(),
  name: z.string(),
});

export const workspaceUpdatedPayload = z.object({
  workspaceId: z.string(),
  changed: z.array(z.string()),
});

export const workspaceArchivedPayload = z.object({
  workspaceId: z.string(),
  /** Children archived in the same cascade (CLAUDE.md §3.4 — archive, never hard delete). */
  cascadedWorkspaceIds: z.array(z.string()),
});

export const memberInvitedPayload = z.object({
  invitationId: z.string(),
  workspaceId: z.string(),
  email: z.string(),
  roleId: z.string(),
});

export const invitationAcceptedPayload = z.object({
  invitationId: z.string(),
  membershipId: z.string(),
  principalId: z.string(),
  /** True when acceptance created a brand-new user (signup-via-invite). */
  newUser: z.boolean(),
});

export const invitationRevokedPayload = z.object({
  invitationId: z.string(),
});

export const membershipCreatedPayload = z.object({
  membershipId: z.string(),
  principalId: z.string(),
  workspaceId: z.string().nullable(),
  roleId: z.string(),
});

export const membershipRoleChangedPayload = z.object({
  membershipId: z.string(),
  roleId: z.string(),
  previousRoleId: z.string().nullable(),
});

export const memberRemovedPayload = z.object({
  membershipId: z.string(),
  principalId: z.string(),
});

export type OrganizationUpdatedPayload = z.infer<typeof organizationUpdatedPayload>;
export type DataProcessingConsentChangedPayload = z.infer<
  typeof dataProcessingConsentChangedPayload
>;
export type WorkspaceCreatedTenancyPayload = z.infer<typeof workspaceCreatedTenancyPayload>;
export type WorkspaceUpdatedPayload = z.infer<typeof workspaceUpdatedPayload>;
export type WorkspaceArchivedPayload = z.infer<typeof workspaceArchivedPayload>;
export type MemberInvitedPayload = z.infer<typeof memberInvitedPayload>;
export type InvitationAcceptedPayload = z.infer<typeof invitationAcceptedPayload>;
export type InvitationRevokedPayload = z.infer<typeof invitationRevokedPayload>;
export type MembershipCreatedPayload = z.infer<typeof membershipCreatedPayload>;
export type MembershipRoleChangedPayload = z.infer<typeof membershipRoleChangedPayload>;
export type MemberRemovedPayload = z.infer<typeof memberRemovedPayload>;
