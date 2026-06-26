import { AccessEventType, CrmEventType, IdentityEventType, TenancyEventType } from '@agentos/contracts';
import type { DeliveredEvent } from '@agentos/message-bus';

/** Allowed values of `audit_log_entries.result` (CHECK constraint in the schema). */
export type AuditResult = 'allow' | 'deny' | 'success' | 'failure';

export interface AuditClassification {
  action: string;
  resourceType: string;
  result: AuditResult;
}

/**
 * Declarative event → audit classification (CLAUDE.md §3.20). Every kernel domain event is
 * security/tenancy/access-relevant, so the writer audits them all; this table gives each a
 * deliberate `action` + `resource_type` (+ `result` where it isn't a plain success) rather than
 * deriving them by string-munging — an audit trail must be precise and reviewable. The keys are
 * the canonical PastTense event-type strings from `@agentos/contracts` (`WorkspaceCreated` is one
 * string shared by the identity and tenancy contexts, so it maps once).
 */
const CLASSIFICATIONS: Record<
  string,
  { action: string; resourceType: string; result?: AuditResult }
> = {
  // identity / onboarding
  [IdentityEventType.UserRegistered]: { action: 'register', resourceType: 'user' },
  [IdentityEventType.OrganizationProvisioned]: { action: 'provision', resourceType: 'organization' },
  [IdentityEventType.OwnerMembershipGranted]: { action: 'grant', resourceType: 'membership' },
  [IdentityEventType.UserAuthenticated]: { action: 'authenticate', resourceType: 'user' },
  [IdentityEventType.SessionCreated]: { action: 'create', resourceType: 'session' },
  [IdentityEventType.TokenRefreshed]: { action: 'refresh', resourceType: 'session' },
  [IdentityEventType.SessionRevoked]: { action: 'revoke', resourceType: 'session' },
  [IdentityEventType.RefreshTokenReuseDetected]: {
    action: 'reuse_detected',
    resourceType: 'session',
    result: 'failure',
  },
  // access / authorization
  [AccessEventType.RoleCreated]: { action: 'create', resourceType: 'role' },
  [AccessEventType.RoleUpdated]: { action: 'update', resourceType: 'role' },
  [AccessEventType.RoleDeleted]: { action: 'delete', resourceType: 'role' },
  [AccessEventType.RoleAssigned]: { action: 'assign', resourceType: 'membership' },
  [AccessEventType.RoleRevoked]: { action: 'revoke', resourceType: 'membership' },
  [AccessEventType.PermissionGranted]: { action: 'grant', resourceType: 'role' },
  [AccessEventType.PermissionRevoked]: { action: 'revoke', resourceType: 'role' },
  [AccessEventType.ServiceAccountCreated]: { action: 'create', resourceType: 'service_account' },
  [AccessEventType.ApiKeyIssued]: { action: 'issue', resourceType: 'api_key' },
  [AccessEventType.ApiKeyRevoked]: { action: 'revoke', resourceType: 'api_key' },
  // tenancy
  [TenancyEventType.OrganizationUpdated]: { action: 'update', resourceType: 'organization' },
  [TenancyEventType.DataProcessingConsentChanged]: {
    action: 'consent_change',
    resourceType: 'organization',
  },
  [TenancyEventType.WorkspaceCreated]: { action: 'create', resourceType: 'workspace' },
  [TenancyEventType.WorkspaceUpdated]: { action: 'update', resourceType: 'workspace' },
  [TenancyEventType.WorkspaceArchived]: { action: 'archive', resourceType: 'workspace' },
  [TenancyEventType.MemberInvited]: { action: 'invite', resourceType: 'invitation' },
  [TenancyEventType.InvitationAccepted]: { action: 'accept', resourceType: 'invitation' },
  [TenancyEventType.InvitationRevoked]: { action: 'revoke', resourceType: 'invitation' },
  [TenancyEventType.MembershipCreated]: { action: 'create', resourceType: 'membership' },
  [TenancyEventType.MembershipRoleChanged]: { action: 'role_change', resourceType: 'membership' },
  [TenancyEventType.MemberRemoved]: { action: 'remove', resourceType: 'membership' },
  // CRM Core — Account + Contact (RFC-002 §9). `ContactErased` is a sensitive op and is always
  // recorded with its acting principal (the trail is what a security review inspects, §8.4).
  [CrmEventType.AccountCreated]: { action: 'create', resourceType: 'account' },
  [CrmEventType.AccountUpdated]: { action: 'update', resourceType: 'account' },
  [CrmEventType.AccountDeleted]: { action: 'delete', resourceType: 'account' },
  [CrmEventType.ContactCreated]: { action: 'create', resourceType: 'contact' },
  [CrmEventType.ContactUpdated]: { action: 'update', resourceType: 'contact' },
  [CrmEventType.ContactDeleted]: { action: 'delete', resourceType: 'contact' },
  [CrmEventType.ContactErased]: { action: 'erase', resourceType: 'contact' },
  [CrmEventType.AccountContactLinked]: { action: 'link', resourceType: 'account_contact' },
  [CrmEventType.AccountContactUnlinked]: { action: 'unlink', resourceType: 'account_contact' },
  [CrmEventType.AccountPrimaryContactChanged]: {
    action: 'set_primary',
    resourceType: 'account_contact',
  },
};

/**
 * Classify a delivered event for the audit trail. Mapped events get their deliberate
 * classification; an unmapped (newly added) event still gets audited — `action` = the raw event
 * type, `resource_type` derived from the aggregate — so introducing an event never silently drops
 * it from the trail (audit-everything, §3.20). The exact event detail is preserved in metadata.
 */
export function classify(event: DeliveredEvent): AuditClassification {
  const mapped = CLASSIFICATIONS[event.type];
  if (mapped) {
    return {
      action: mapped.action,
      resourceType: mapped.resourceType,
      result: mapped.result ?? 'success',
    };
  }
  return { action: event.type, resourceType: event.aggregateType.toLowerCase(), result: 'success' };
}
