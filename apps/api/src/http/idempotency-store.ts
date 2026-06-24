import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/** Outcome of claiming an idempotency key. */
export type IdempotencyDecision =
  | { kind: 'claimed' } // first time seen — caller runs the handler
  | { kind: 'in_progress' } // an identical request is still running
  | { kind: 'mismatch' } // same key, different request payload
  | { kind: 'replay'; status: number; body: unknown }; // completed — replay the stored response

interface StoredRecord {
  state: 'in_flight' | 'completed';
  fingerprint: string;
  status?: number;
  body?: unknown;
}

/**
 * Redis-backed idempotency record store (CLAUDE.md §2 — Redis for idempotency keys). A key holds an
 * in-flight lock while the handler runs, then the completed response for replay within the TTL.
 * Tenant scoping lives in the key the caller builds; this class only manages the record lifecycle.
 */
@Injectable()
export class IdempotencyStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Atomically claim the key, or report what already exists under it. */
  async begin(key: string, fingerprint: string, ttlSeconds: number): Promise<IdempotencyDecision> {
    const claim = JSON.stringify({ state: 'in_flight', fingerprint } satisfies StoredRecord);
    const claimed = await this.redis.set(key, claim, 'EX', ttlSeconds, 'NX');
    if (claimed === 'OK') {
      return { kind: 'claimed' };
    }
    const raw = await this.redis.get(key);
    if (raw === null) {
      // The record expired between the failed NX and this GET; try to claim once more.
      const retry = await this.redis.set(key, claim, 'EX', ttlSeconds, 'NX');
      return retry === 'OK' ? { kind: 'claimed' } : { kind: 'in_progress' };
    }
    const record = JSON.parse(raw) as StoredRecord;
    if (record.fingerprint !== fingerprint) {
      return { kind: 'mismatch' };
    }
    if (record.state === 'completed') {
      return { kind: 'replay', status: record.status ?? 200, body: record.body };
    }
    return { kind: 'in_progress' };
  }

  /** Store the completed response so subsequent identical requests replay it. */
  async complete(
    key: string,
    fingerprint: string,
    status: number,
    body: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    const record = JSON.stringify({
      state: 'completed',
      fingerprint,
      status,
      body,
    } satisfies StoredRecord);
    await this.redis.set(key, record, 'EX', ttlSeconds);
  }

  /** Release the in-flight lock (handler failed) so the client can retry. */
  async release(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
