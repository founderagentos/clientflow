import type { Params } from 'nestjs-pino';
import { createBaseLoggerOptions } from './logger';

/**
 * nestjs-pino module params wiring the platform logger into NestJS so framework logs and
 * request logs share the same structured, tenant-stamped, redacted Pino instance (§3.20).
 */
export function loggerModuleParams(): Params {
  return {
    pinoHttp: {
      ...createBaseLoggerOptions(),
      autoLogging: true,
      customProps: () => ({}),
    },
  };
}
