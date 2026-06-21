import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ApiKeyService } from '@agentos/identity';
import { runWithTenantContext, type TenantContext } from '@agentos/tenant-context';

interface MutableRequest {
  headers: Record<string, unknown>;
}

/** Reads an API key from `X-Api-Key` or an `Authorization: ApiKey <secret>` header. */
function extractApiKey(headers: Record<string, unknown>): string | undefined {
  const direct = headers['x-api-key'];
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  const auth = headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('ApiKey ')) {
    return auth.slice('ApiKey '.length);
  }
  return undefined;
}

/**
 * Resolves a service-account API key into the ambient TenantContext (CLAUDE.md §3.2 — agents are
 * principals, authorized and audited identically). Runs before {@link TenantContextMiddleware};
 * on a valid key it binds a `service_account` principal so the PDP and audit attribute the agent
 * as the actor. A missing/invalid key passes through untouched (route guards enforce auth), and
 * a bearer-token request simply has no API key here. Key authentication itself happens
 * pre-tenant-context via a SECURITY DEFINER lookup (db/policies/042-api-key-functions.sql).
 */
@Injectable()
export class ApiKeyAuthMiddleware implements NestMiddleware {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async use(req: MutableRequest, _res: unknown, next: () => void): Promise<void> {
    const key = extractApiKey(req.headers);
    if (!key) {
      next();
      return;
    }
    const authenticated = await this.apiKeys.authenticate(key);
    if (!authenticated) {
      next();
      return;
    }
    const header = req.headers['x-correlation-id'];
    const correlationId = typeof header === 'string' && header.length > 0 ? header : randomUUID();
    const ctx: TenantContext = {
      organizationId: authenticated.organizationId,
      workspaceId: authenticated.workspaceId,
      principal: { id: authenticated.principalId, type: 'service_account' },
      correlationId,
    };
    runWithTenantContext(ctx, () => next());
  }
}
