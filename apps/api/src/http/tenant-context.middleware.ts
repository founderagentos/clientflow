import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AccessTokenService } from '@agentos/identity';
import { getTenantContext, runWithTenantContext, type TenantContext } from '@agentos/tenant-context';

interface MutableRequest {
  headers: Record<string, unknown>;
  auth?: {
    principalId: string;
    organizationId: string;
    workspaceId: string | null;
    tokenVersion: number;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate an `X-Workspace-Id` header into a workspace id, or null when absent/malformed. */
function selectWorkspace(header: unknown): string | null {
  return typeof header === 'string' && UUID_RE.test(header) ? header : null;
}

/**
 * Resolves an optional bearer token into the request's `auth` and binds the ambient
 * TenantContext (CLAUDE.md §3.7/§3.20) so logs auto-inject tenant/correlation ids. Anonymous
 * routes (register/login/refresh) and invalid tokens pass through untouched — route guards
 * enforce authentication where required. Single point of token verification per request.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tokens: AccessTokenService) {}

  async use(req: MutableRequest, _res: unknown, next: () => void): Promise<void> {
    // An earlier auth middleware (API-key) may have already bound a service-account context.
    if (getTenantContext()) {
      next();
      return;
    }
    const header = req.headers.authorization;
    const bearer =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!bearer) {
      next();
      return;
    }
    try {
      const claims = await this.tokens.verify(bearer);
      // Active-workspace selection (RFC-002 §6): an **org-level** principal (token `workspaceId` null,
      // e.g. an Owner whose membership spans the org) may target a specific workspace via the
      // `X-Workspace-Id` header — required to reach the workspace-scoped CRM surface. A principal whose
      // token already pins a workspace ignores the header, so it can never widen that principal's
      // reach; and the organization is taken only from the token, so RLS still confines every row to
      // the caller's org. An absent/invalid header on an org-level token leaves the context org-scoped.
      const workspaceId = claims.workspaceId ?? selectWorkspace(req.headers['x-workspace-id']);
      req.auth = {
        principalId: claims.principalId,
        organizationId: claims.organizationId,
        workspaceId,
        tokenVersion: claims.tokenVersion,
      };
      // Auto-inject a correlation id (§3.20). Honour an upstream gateway's value; otherwise mint
      // one so every log line and every emitted domain event carries a non-empty correlation id.
      const header = req.headers['x-correlation-id'];
      const correlationId = typeof header === 'string' && header.length > 0 ? header : randomUUID();
      const ctx: TenantContext = {
        organizationId: claims.organizationId,
        workspaceId,
        principal: { id: claims.principalId, type: 'user' },
        correlationId,
      };
      runWithTenantContext(ctx, () => next());
    } catch {
      next();
    }
  }
}
