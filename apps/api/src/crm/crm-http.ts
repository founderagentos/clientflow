import { z } from 'zod';
import { BadRequestError } from '@agentos/result-errors';
import { requireTenantContext } from '@agentos/tenant-context';

/**
 * Shared HTTP helpers for the CRM controllers (RFC-002 §7) — the acting actor, keyset-cursor codec,
 * and the body schemas reused across every resource. Kept in the host (apps/api) because the
 * controllers depend on host artifacts (`RequirePermissionGuard`, the orchestrators) and so cannot
 * live inside a `type:module` package (CLAUDE.md §17).
 */

/** The acting principal + active tenant a CRM service expects (structurally a CrmActor/DealActor/LeadActor). */
export interface CrmHttpActor {
  principalId: string;
  organizationId: string;
  workspaceId: string;
  correlationId: string;
  principalType: 'user' | 'service_account';
}

/**
 * Resolve the CRM actor from the ambient TenantContext. CRM is **workspace-scoped** (the RLS policy
 * keys on the active workspace, crm.md), so a request with no active workspace cannot address CRM
 * data — reject it with 400 rather than defaulting (CLAUDE.md §3.7). `principalType` is carried so a
 * service-account caller is authorized + attributed identically to a human (§3.2 parity).
 */
export function crmActor(): CrmHttpActor {
  const ctx = requireTenantContext();
  if (!ctx.workspaceId) {
    throw new BadRequestError('An active workspace is required for CRM operations');
  }
  return {
    principalId: ctx.principal.id,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    correlationId: ctx.correlationId,
    principalType: ctx.principal.type,
  };
}

/** Newest-first keyset cursor over `(created_at, id)` — the same opaque scheme the audit query uses. */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export interface Keyset {
  createdAt: Date;
  id: string;
}

/** Decode an opaque cursor token back to its `(createdAt, id)` keyset; a malformed token is a 400. */
export function decodeCursor(token: string | undefined): Keyset | undefined {
  if (token === undefined) {
    return undefined;
  }
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const sep = decoded.indexOf('|');
  if (sep === -1) {
    throw new BadRequestError('Invalid pagination cursor');
  }
  const createdAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new BadRequestError('Invalid pagination cursor');
  }
  return { createdAt, id };
}

/**
 * Map a keyset page of rows to its `{ items, nextCursor }` HTTP envelope. `nextCursor` is the last
 * row's cursor when the page is full (a further page may exist), else `null` (RFC §7 pagination).
 */
export function pageResult<R extends { createdAt: Date; id: string }, V>(
  rows: R[],
  limit: number,
  toView: (row: R) => V,
): { items: V[]; nextCursor: string | null } {
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toView),
    nextCursor: rows.length === limit && last ? encodeCursor(last) : null,
  };
}

/** Query string for every CRM list endpoint: an opaque `cursor` + a bounded `limit` (RFC §7). */
export const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** The optimistic-lock assertion body shared by version-guarded deletes (CLAUDE.md §3.4 → 409). */
export const versionBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

/** A decimal amount/probability carried as a string (Drizzle numeric ⇄ string), or null. */
export const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a decimal number');

/**
 * Reconcile a Zod-validated body with a service input type at the trust boundary. Zod's `.optional()`
 * widens every optional to `T | undefined`, which `exactOptionalPropertyTypes` rejects against the
 * services' exact-optional inputs. The parser has already guaranteed the runtime shape (and omits
 * absent optionals entirely), so this is a sound, local narrowing — `T` is inferred from the call site.
 */
export function asInput<T>(value: unknown): T {
  return value as T;
}
