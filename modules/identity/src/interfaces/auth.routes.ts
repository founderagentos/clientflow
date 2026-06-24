import type { RouteDescriptor } from '@agentos/contracts';
import { loginBodySchema, refreshBodySchema, logoutBodySchema } from './auth.dto';

/**
 * OpenAPI route descriptors for the identity auth surface (CLAUDE.md §6). Exported via the module's
 * public index so the host can assemble the API document without importing module internals.
 */
export const authRouteDescriptors: RouteDescriptor[] = [
  {
    method: 'post',
    path: '/api/v1/auth/login',
    summary: 'Authenticate with email and password',
    tags: ['Auth'],
    security: 'none',
    body: loginBodySchema,
    response: { status: 200, description: 'Access token issued' },
  },
  {
    method: 'post',
    path: '/api/v1/auth/refresh',
    summary: 'Rotate the refresh token and issue a new access token',
    tags: ['Auth'],
    security: 'none',
    body: refreshBodySchema,
    response: { status: 200, description: 'Access token refreshed' },
  },
  {
    method: 'post',
    path: '/api/v1/auth/logout',
    summary: 'Revoke the current refresh-token family',
    tags: ['Auth'],
    security: 'none',
    body: logoutBodySchema,
    response: { status: 204, description: 'Logged out' },
  },
  {
    method: 'get',
    path: '/api/v1/auth/me',
    summary: 'Return the authenticated principal',
    tags: ['Auth'],
    security: 'bearer',
    response: { status: 200, description: 'The current principal' },
  },
  {
    method: 'get',
    path: '/api/v1/auth/sessions',
    summary: 'List the active sessions for the current principal',
    tags: ['Auth'],
    security: 'bearer',
    response: { status: 200, description: 'Active sessions' },
  },
  {
    method: 'delete',
    path: '/api/v1/auth/sessions/:id',
    summary: 'Revoke a specific session',
    tags: ['Auth'],
    security: 'bearer',
    response: { status: 204, description: 'Session revoked' },
  },
];
