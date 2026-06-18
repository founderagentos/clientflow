import { AsyncLocalStorage } from 'node:async_hooks';
import type { Id } from '@agentos/identifier';
import { TenantContextMissingError } from '@agentos/result-errors';

/** Both humans and AI agents/automations are principals (CLAUDE.md §3.2). */
export type PrincipalType = 'user' | 'service_account';

export interface Principal {
  readonly id: Id;
  readonly type: PrincipalType;
}

/**
 * The ambient tenant + actor context for a unit of work. Resolved at the edge from the
 * authenticated request and propagated implicitly (CLAUDE.md §4 platform/tenant-context).
 * `workspaceId === null` means an org-scoped operation (§3.4).
 */
export interface TenantContext {
  readonly organizationId: Id;
  readonly workspaceId: Id | null;
  readonly principal: Principal;
  /** Correlation id propagated across HTTP and events (§3.20). */
  readonly correlationId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Run `fn` with the given tenant context bound to the async scope. */
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current tenant context, or `undefined` if none is bound. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * The current tenant context, or throw. A request with no resolved tenant is denied,
 * never defaulted (CLAUDE.md §3.7).
 */
export function requireTenantContext(): TenantContext {
  const context = storage.getStore();
  if (!context) {
    throw new TenantContextMissingError();
  }
  return context;
}
