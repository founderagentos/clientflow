import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from './redis.tokens';
import type { HealthDetail } from '../health/health.types';

@Injectable()
export class RedisHealthIndicator {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async check(): Promise<HealthDetail> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG'
        ? { status: 'up' }
        : { status: 'down', error: `unexpected ping reply: ${pong}` };
    } catch (error) {
      return { status: 'down', error: error instanceof Error ? error.message : String(error) };
    }
  }
}
