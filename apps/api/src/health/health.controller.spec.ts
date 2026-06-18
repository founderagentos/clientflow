import { describe, it, expect, vi } from 'vitest';
import { HealthController } from './health.controller';
import type { DatabaseHealthIndicator } from '../persistence/database.health-indicator';
import type { RedisHealthIndicator } from '../redis/redis.health-indicator';
import type { HealthDetail } from './health.types';

const indicator = (detail: HealthDetail) => ({ check: async () => detail });

function fakeReply() {
  const reply = {
    statusCode: 0,
    status: vi.fn((code: number) => {
      reply.statusCode = code;
      return reply;
    }),
  };
  return reply;
}

describe('HealthController', () => {
  it('reports ok / 200 when db and redis are both up', async () => {
    const controller = new HealthController(
      indicator({ status: 'up' }) as unknown as DatabaseHealthIndicator,
      indicator({ status: 'up' }) as unknown as RedisHealthIndicator,
    );
    const reply = fakeReply();

    const report = await controller.check(reply as never);

    expect(report.status).toBe('ok');
    expect(reply.statusCode).toBe(200);
  });

  it('reports error / 503 when a dependency is down', async () => {
    const controller = new HealthController(
      indicator({ status: 'up' }) as unknown as DatabaseHealthIndicator,
      indicator({ status: 'down', error: 'ECONNREFUSED' }) as unknown as RedisHealthIndicator,
    );
    const reply = fakeReply();

    const report = await controller.check(reply as never);

    expect(report.status).toBe('error');
    expect(report.info.redis.status).toBe('down');
    expect(reply.statusCode).toBe(503);
  });
});
