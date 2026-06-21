import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PermissionCachePort } from '../application/permission-cache.port';
import { ACCESS_CACHE_REDIS } from './access-cache-redis.token';

/**
 * Redis-backed resolved-permission cache (CLAUDE.md §3.10) with **generation-counter
 * invalidation**. Each (principal, organization) has a monotonic generation; a cache entry is
 * keyed by the current generation, so `invalidate` is a single atomic `INCR` of that counter —
 * instantly global across every app instance (shared Redis), with no key scanning. Stale
 * entries from older generations simply expire via their safety TTL.
 *
 * Fails safe: any Redis error degrades to a cache miss (the PDP re-resolves from the database),
 * never to an allow. A failed `invalidate` is backstopped by the entry TTL, so a revoked grant
 * can outlive its revocation by at most `ENTRY_TTL_SECONDS` even if Redis is unreachable.
 */
@Injectable()
export class RedisPermissionCache implements PermissionCachePort {
  private static readonly ENTRY_TTL_SECONDS = 300;

  constructor(@Inject(ACCESS_CACHE_REDIS) private readonly redis: Redis) {}

  async get(
    principalId: string,
    organizationId: string,
    workspaceId: string | null,
  ): Promise<Set<string> | null> {
    try {
      const gen = await this.generation(principalId, organizationId);
      const raw = await this.redis.get(this.entryKey(principalId, organizationId, gen, workspaceId));
      if (raw === null) {
        return null;
      }
      return new Set<string>(JSON.parse(raw) as string[]);
    } catch {
      return null;
    }
  }

  async set(
    principalId: string,
    organizationId: string,
    workspaceId: string | null,
    permissions: Set<string>,
  ): Promise<void> {
    try {
      const gen = await this.generation(principalId, organizationId);
      await this.redis.set(
        this.entryKey(principalId, organizationId, gen, workspaceId),
        JSON.stringify([...permissions]),
        'EX',
        RedisPermissionCache.ENTRY_TTL_SECONDS,
      );
    } catch {
      // Best-effort cache population; a failure just means the next read re-resolves.
    }
  }

  async invalidate(principalId: string, organizationId: string): Promise<void> {
    try {
      await this.redis.incr(this.generationKey(principalId, organizationId));
    } catch {
      // Backstopped by the per-entry TTL (see class doc).
    }
  }

  private async generation(principalId: string, organizationId: string): Promise<string> {
    const gen = await this.redis.get(this.generationKey(principalId, organizationId));
    return gen ?? '0';
  }

  private generationKey(principalId: string, organizationId: string): string {
    return `acl:gen:${principalId}:${organizationId}`;
  }

  private entryKey(
    principalId: string,
    organizationId: string,
    gen: string,
    workspaceId: string | null,
  ): string {
    return `acl:perm:${principalId}:${organizationId}:${gen}:${workspaceId ?? 'org'}`;
  }
}
