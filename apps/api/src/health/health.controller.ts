import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DatabaseHealthIndicator } from '../persistence/database.health-indicator';
import { RedisHealthIndicator } from '../redis/redis.health-indicator';
import type { HealthDetail } from './health.types';

export interface HealthReport {
  status: 'ok' | 'error';
  info: { db: HealthDetail; redis: HealthDetail };
  timestamp: string;
}

/** Liveness/readiness probe — green only when Postgres and Redis are both reachable. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const [db, redis] = await Promise.all([this.db.check(), this.redis.check()]);
    const healthy = db.status === 'up' && redis.status === 'up';
    reply.status(healthy ? 200 : 503);
    return {
      status: healthy ? 'ok' : 'error',
      info: { db, redis },
      timestamp: new Date().toISOString(),
    };
  }
}
