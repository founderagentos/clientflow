import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
}

let sdk: NodeSDK | undefined;

/**
 * Start OpenTelemetry tracing (CLAUDE.md §2). Must be called before NestJS bootstraps so
 * auto-instrumentation can patch HTTP/pg/redis. A no-op unless OTEL_EXPORTER_OTLP_ENDPOINT
 * is configured, so local/dev runs without a collector are unaffected.
 */
export function startTelemetry(options: TelemetryOptions): void {
  if (sdk) return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion ?? '0.0.0',
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

/** Flush and shut down telemetry (call on graceful shutdown). */
export async function stopTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
