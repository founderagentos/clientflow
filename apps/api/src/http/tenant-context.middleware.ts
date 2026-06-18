import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AccessTokenService } from '@agentos/identity';
import { runWithTenantContext, type TenantContext } from '@agentos/tenant-context';

interface MutableRequest {
  headers: Record<string, unknown>;
  auth?: {
    principalId: string;
    organizationId: string;
    workspaceId: string | null;
    tokenVersion: number;
  };
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
    const header = req.headers.authorization;
    const bearer =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!bearer) {
      next();
      return;
    }
    try {
      const claims = await this.tokens.verify(bearer);
      req.auth = {
        principalId: claims.principalId,
        organizationId: claims.organizationId,
        workspaceId: claims.workspaceId,
        tokenVersion: claims.tokenVersion,
      };
      const correlationId = req.headers['x-correlation-id'];
      const ctx: TenantContext = {
        organizationId: claims.organizationId,
        workspaceId: claims.workspaceId,
        principal: { id: claims.principalId, type: 'user' },
        correlationId: typeof correlationId === 'string' ? correlationId : '',
      };
      runWithTenantContext(ctx, () => next());
    } catch {
      next();
    }
  }
}
