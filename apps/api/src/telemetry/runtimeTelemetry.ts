import {
  createExceptionCapture,
  type ExceptionCaptureContext
} from '../../../../packages/telemetry-sdk/src/exceptionCapture.js';
import { createServerTelemetry } from '../../../../packages/telemetry-sdk/src/server.js';
import { ServerSpool } from '../../../../packages/telemetry-sdk/src/serverSpool.js';
import { createSignedServerTransport } from '../../../../packages/telemetry-sdk/src/serverTransport.js';
import type { OpsRuntimeConfig } from '../runtime/runtimeConfig.js';

type RuntimeTelemetryContext = Omit<ExceptionCaptureContext, 'eventId'> & {
  method?: string;
  status?: number;
};

type ServerTelemetryInput = Parameters<typeof createServerTelemetry>[0];

export type RuntimeTelemetry = {
  captureException: (error: unknown, context: RuntimeTelemetryContext) => `EVT_${string}` | undefined;
  flush: () => Promise<void>;
  healthy: () => boolean;
};

export function createRuntimeTelemetry(input: {
  enabled: boolean;
  required?: boolean;
  release: string;
  service: string;
  transport: ServerTelemetryInput['transport'];
  spool?: ServerTelemetryInput['spool'];
}): RuntimeTelemetry {
  if (!input.enabled) {
    return {
      captureException: () => undefined,
      flush: async () => undefined,
      healthy: () => !input.required
    };
  }

  const reporter = createServerTelemetry({
    release: input.release,
    service: input.service,
    transport: input.transport,
    ...(input.spool ? { spool: input.spool } : {})
  });
  const capture = createExceptionCapture({
    capture: async (error, context) => {
      await reporter.captureException(error, context);
    }
  });

  return {
    captureException: (error, context) => {
      const { method, status, tags, ...captureContext } = context;
      return capture.captureOnce(error, {
        ...captureContext,
        ...(method || status
          ? {
              tags: {
                ...tags,
                ...(method ? { method: method.slice(0, 16) } : {}),
                ...(status ? { httpStatus: String(status) } : {})
              }
            }
          : tags
            ? { tags }
            : {})
      });
    },
    flush: () => reporter.flush(),
    healthy: () => true
  };
}

export function createConfiguredRuntimeTelemetry(input: {
  config: Extract<OpsRuntimeConfig['telemetry'], { enabled: true }>;
  hmacSecret: string;
  service: string;
  spool?: ServerTelemetryInput['spool'];
  fetch?: typeof globalThis.fetch;
}): RuntimeTelemetry {
  const spool =
    input.spool ??
    new ServerSpool({
      allowedRoot: input.config.spoolRoot,
      spoolDirectory: input.config.spoolDirectory
    });
  return createRuntimeTelemetry({
    enabled: true,
    release: input.config.release,
    service: input.service,
    transport: createSignedServerTransport({
      endpoint: input.config.endpoint,
      keyId: input.config.keyId,
      secret: input.hmacSecret,
      ...(input.fetch ? { fetch: input.fetch } : {})
    }),
    spool
  });
}
