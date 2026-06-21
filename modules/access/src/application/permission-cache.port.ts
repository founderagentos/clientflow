/**
 * Port for the resolved-permission cache (CLAUDE.md §3.10) — the PDP caches a principal's
 * effective permission set per (principal, organization, workspace) and invalidates it on
 * role/permission changes. The Redis adapter lives in infrastructure; the domain/application
 * depends only on this port (ports & adapters, §17).
 */
export interface PermissionCachePort {
  get(
    principalId: string,
    organizationId: string,
    workspaceId: string | null,
  ): Promise<Set<string> | null>;

  set(
    principalId: string,
    organizationId: string,
    workspaceId: string | null,
    permissions: Set<string>,
  ): Promise<void>;

  /** Invalidate every cached scope for a principal in an organization (immediate, global). */
  invalidate(principalId: string, organizationId: string): Promise<void>;
}

export const PERMISSION_CACHE = Symbol('agentos.access.permission-cache');
