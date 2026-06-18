import { startTelemetry } from '@agentos/observability';

// Started before NestJS so OpenTelemetry auto-instrumentation can patch HTTP/pg/redis.
// No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
startTelemetry({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'agentos-api',
  serviceVersion: '0.0.0',
});
