import { ValidationError } from '@agentos/result-errors';

/**
 * An explicit `resource.action` permission string (CLAUDE.md §3.10) — e.g. `lead.read`,
 * `agent.execute`. Permissions are never wildcards and never embedded in the access token; the
 * PDP resolves them server-side against this exact string.
 */
export type PermissionKey = `${string}.${string}`;

// Lowercase snake_case resource + action, separated by a single dot (naming rule §3.19).
const KEY_RE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

export function isPermissionKey(raw: string): raw is PermissionKey {
  return KEY_RE.test(raw);
}

/** Parse/validate an external permission string; 422 on a malformed key. */
export function parsePermissionKey(raw: string): PermissionKey {
  if (!isPermissionKey(raw)) {
    throw new ValidationError('Invalid permission key', {
      permission: ['must be a lowercase resource.action string'],
    });
  }
  return raw;
}

export function permissionKey(resource: string, action: string): PermissionKey {
  return parsePermissionKey(`${resource}.${action}`);
}
