import { z } from 'zod';

/**
 * Edge validation for the audit query surface (CLAUDE.md §2 — Zod at every boundary). Query-string
 * values arrive as strings, so `limit`/dates are coerced. `limit` is capped to keep keyset pages
 * bounded.
 */
export const auditQuerySchema = z.object({
  actorPrincipalId: z.string().uuid().optional(),
  resourceType: z.string().trim().min(1).max(64).optional(),
  resourceId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(64).optional(),
  result: z.enum(['allow', 'deny', 'success', 'failure']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Opaque keyset cursor from a prior page's `nextCursor`. */
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
