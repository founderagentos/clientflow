import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import { PG_CLIENT } from './database.tokens';
import type { HealthDetail } from '../health/health.types';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(@Inject(PG_CLIENT) private readonly sql: Sql) {}

  async check(): Promise<HealthDetail> {
    try {
      await this.sql`select 1`;
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: error instanceof Error ? error.message : String(error) };
    }
  }
}
