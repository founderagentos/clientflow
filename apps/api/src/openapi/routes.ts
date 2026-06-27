import type { RouteDescriptor } from '@agentos/contracts';
import { authRouteDescriptors } from '@agentos/identity';
import {
  createRoleBodySchema,
  renameRoleBodySchema,
  archiveBodySchema,
  grantPermissionBodySchema,
  assignRoleBodySchema,
  createServiceAccountBodySchema,
  issueApiKeyBodySchema,
} from '../access/access.dto';
import {
  updateOrganizationBodySchema,
  consentBodySchema,
  createWorkspaceBodySchema,
  updateWorkspaceBodySchema,
  archiveWorkspaceBodySchema,
  createInvitationBodySchema,
  acceptInvitationBodySchema,
} from '../tenancy/tenancy.dto';
import { auditQuerySchema } from '../audit/audit.dto';
import { registerBodySchema } from '../onboarding/register.dto';
import { crmRouteDescriptors } from '../crm/crm.routes';

/**
 * The complete HTTP route registry (CLAUDE.md §6). Reuses each route's existing Zod DTO so the
 * OpenAPI document never drifts from validation; a coverage test asserts this list matches the live
 * Nest routes. Identity routes come from the module's public export; the rest are app-hosted.
 */
const onboardingRoutes: RouteDescriptor[] = [
  {
    method: 'post',
    path: '/api/v1/auth/register',
    summary: 'Register a user and auto-provision their organization, workspace, and Owner membership',
    tags: ['Auth'],
    security: 'none',
    body: registerBodySchema,
    response: { status: 201, description: 'Registered; access token issued' },
  },
];

const organizationRoutes: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/api/v1/organizations/current',
    summary: 'Read the active organization',
    tags: ['Organizations'],
    permission: 'organization.read',
    response: { status: 200, description: 'The current organization' },
  },
  {
    method: 'patch',
    path: '/api/v1/organizations/current',
    summary: 'Update the active organization',
    tags: ['Organizations'],
    permission: 'organization.update',
    body: updateOrganizationBodySchema,
    response: { status: 200, description: 'Updated organization' },
  },
  {
    method: 'put',
    path: '/api/v1/organizations/current/data-processing-consent',
    summary: 'Set the organization data-processing consent flag',
    tags: ['Organizations'],
    permission: 'organization.update',
    body: consentBodySchema,
    response: { status: 200, description: 'Consent updated' },
  },
];

const workspaceRoutes: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/api/v1/workspaces',
    summary: 'List workspaces in the active organization',
    tags: ['Workspaces'],
    permission: 'workspace.read',
    response: { status: 200, description: 'Workspaces' },
  },
  {
    method: 'post',
    path: '/api/v1/workspaces',
    summary: 'Create a workspace',
    tags: ['Workspaces'],
    permission: 'workspace.create',
    body: createWorkspaceBodySchema,
    response: { status: 201, description: 'Created workspace' },
  },
  {
    method: 'get',
    path: '/api/v1/workspaces/:id',
    summary: 'Read a workspace',
    tags: ['Workspaces'],
    permission: 'workspace.read',
    response: { status: 200, description: 'The workspace' },
  },
  {
    method: 'patch',
    path: '/api/v1/workspaces/:id',
    summary: 'Update a workspace',
    tags: ['Workspaces'],
    permission: 'workspace.update',
    body: updateWorkspaceBodySchema,
    response: { status: 200, description: 'Updated workspace' },
  },
  {
    method: 'delete',
    path: '/api/v1/workspaces/:id',
    summary: 'Archive a workspace',
    tags: ['Workspaces'],
    permission: 'workspace.delete',
    body: archiveWorkspaceBodySchema,
    response: { status: 204, description: 'Archived' },
  },
  {
    method: 'get',
    path: '/api/v1/workspaces/:id/members',
    summary: 'List members of a workspace',
    tags: ['Workspaces'],
    permission: 'member.read',
    response: { status: 200, description: 'Members' },
  },
];

const invitationRoutes: RouteDescriptor[] = [
  {
    method: 'post',
    path: '/api/v1/workspaces/:id/invitations',
    summary: 'Invite a member to a workspace',
    tags: ['Invitations'],
    permission: 'member.invite',
    body: createInvitationBodySchema,
    response: { status: 201, description: 'Invitation created' },
  },
  {
    method: 'get',
    path: '/api/v1/workspaces/:id/invitations',
    summary: 'List pending invitations for a workspace',
    tags: ['Invitations'],
    permission: 'member.read',
    response: { status: 200, description: 'Invitations' },
  },
  {
    method: 'delete',
    path: '/api/v1/invitations/:id',
    summary: 'Revoke an invitation',
    tags: ['Invitations'],
    permission: 'member.invite',
    response: { status: 204, description: 'Revoked' },
  },
  {
    method: 'post',
    path: '/api/v1/invitations/:token/accept',
    summary: 'Accept an invitation by token',
    tags: ['Invitations'],
    security: 'none',
    body: acceptInvitationBodySchema,
    response: { status: 200, description: 'Invitation accepted; membership created' },
  },
];

const membershipRoutes: RouteDescriptor[] = [
  {
    method: 'delete',
    path: '/api/v1/memberships/:id',
    summary: 'Remove a membership',
    tags: ['Memberships'],
    permission: 'member.remove',
    response: { status: 204, description: 'Removed' },
  },
  {
    method: 'post',
    path: '/api/v1/memberships/:membershipId/roles',
    summary: 'Assign a role to a membership',
    tags: ['Roles'],
    permission: 'role.assign',
    body: assignRoleBodySchema,
    response: { status: 201, description: 'Role assigned' },
  },
  {
    method: 'delete',
    path: '/api/v1/memberships/:membershipId/roles/:roleId',
    summary: 'Revoke a role from a membership',
    tags: ['Roles'],
    permission: 'role.assign',
    response: { status: 200, description: 'Role revoked' },
  },
];

const roleRoutes: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/api/v1/roles',
    summary: 'List roles',
    tags: ['Roles'],
    permission: 'role.read',
    response: { status: 200, description: 'Roles' },
  },
  {
    method: 'post',
    path: '/api/v1/roles',
    summary: 'Create a role',
    tags: ['Roles'],
    permission: 'role.create',
    body: createRoleBodySchema,
    response: { status: 201, description: 'Created role' },
  },
  {
    method: 'patch',
    path: '/api/v1/roles/:id',
    summary: 'Rename a role',
    tags: ['Roles'],
    permission: 'role.update',
    body: renameRoleBodySchema,
    response: { status: 200, description: 'Updated role' },
  },
  {
    method: 'delete',
    path: '/api/v1/roles/:id',
    summary: 'Delete a role',
    tags: ['Roles'],
    permission: 'role.delete',
    body: archiveBodySchema,
    response: { status: 200, description: 'Deleted' },
  },
  {
    method: 'post',
    path: '/api/v1/roles/:id/permissions',
    summary: 'Grant a permission to a role',
    tags: ['Roles'],
    permission: 'role.update',
    body: grantPermissionBodySchema,
    response: { status: 201, description: 'Permission granted' },
  },
  {
    method: 'delete',
    path: '/api/v1/roles/:id/permissions/:permissionKey',
    summary: 'Revoke a permission from a role',
    tags: ['Roles'],
    permission: 'role.update',
    response: { status: 200, description: 'Permission revoked' },
  },
];

const permissionRoutes: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/api/v1/permissions',
    summary: 'List the permission catalog',
    tags: ['Permissions'],
    permission: 'role.read',
    response: { status: 200, description: 'Permissions' },
  },
];

const serviceAccountRoutes: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/api/v1/service-accounts',
    summary: 'List service accounts',
    tags: ['Service Accounts'],
    permission: 'service_account.read',
    response: { status: 200, description: 'Service accounts' },
  },
  {
    method: 'post',
    path: '/api/v1/service-accounts',
    summary: 'Create a service account',
    tags: ['Service Accounts'],
    permission: 'service_account.create',
    body: createServiceAccountBodySchema,
    response: { status: 201, description: 'Created service account' },
  },
  {
    method: 'delete',
    path: '/api/v1/service-accounts/:id',
    summary: 'Delete a service account',
    tags: ['Service Accounts'],
    permission: 'service_account.delete',
    response: { status: 200, description: 'Deleted' },
  },
  {
    method: 'post',
    path: '/api/v1/service-accounts/:id/api-keys',
    summary: 'Issue an API key for a service account',
    tags: ['Service Accounts'],
    permission: 'api_key.create',
    body: issueApiKeyBodySchema,
    response: { status: 201, description: 'API key issued (secret returned once)' },
  },
  {
    method: 'get',
    path: '/api/v1/service-accounts/:id/api-keys',
    summary: 'List a service account API keys',
    tags: ['Service Accounts'],
    permission: 'api_key.read',
    response: { status: 200, description: 'API keys' },
  },
  {
    method: 'delete',
    path: '/api/v1/api-keys/:id',
    summary: 'Revoke an API key',
    tags: ['API Keys'],
    permission: 'api_key.revoke',
    response: { status: 200, description: 'Revoked' },
  },
];

const auditRoutes: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/api/v1/audit-log-entries',
    summary: 'Query the append-only audit log',
    tags: ['Audit'],
    permission: 'audit.read',
    query: auditQuerySchema,
    response: { status: 200, description: 'Audit log entries (cursor-paginated)' },
  },
];

const healthRoutes: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/api/v1/health',
    summary: 'Liveness/readiness probe',
    tags: ['Health'],
    security: 'none',
    response: { status: 200, description: 'Service healthy' },
  },
];

/** Every documented route, in a stable order. */
export const API_ROUTES: RouteDescriptor[] = [
  ...authRouteDescriptors,
  ...onboardingRoutes,
  ...organizationRoutes,
  ...workspaceRoutes,
  ...invitationRoutes,
  ...membershipRoutes,
  ...roleRoutes,
  ...permissionRoutes,
  ...serviceAccountRoutes,
  ...auditRoutes,
  ...crmRouteDescriptors,
  ...healthRoutes,
];
