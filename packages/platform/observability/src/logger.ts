import type { LoggerOptions } from 'pino';
import { getTenantContext } from '@agentos/tenant-context';

/**
 * Paths Pino redacts so passwords, secrets and tokens never reach logs (CLAUDE.md §3.20).
 * Covers both top-level and one-level-nested occurrences of sensitive field names.
 */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'secretHash',
  '*.secretHash',
  'keyHash',
  '*.keyHash',
  'apiKey',
  '*.apiKey',
];

/**
 * Base Pino options: structured JSON only, secrets redacted, and a mixin that auto-injects
 * the tenant/correlation identifiers from the ambient TenantContext (§3.20) onto every line.
 */
export function createBaseLoggerOptions(): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    mixin() {
      const ctx = getTenantContext();
      if (!ctx) return {};
      return {
        organization_id: ctx.organizationId,
        workspace_id: ctx.workspaceId,
        principal_id: ctx.principal.id,
        correlation_id: ctx.correlationId,
      };
    },
  };
}
