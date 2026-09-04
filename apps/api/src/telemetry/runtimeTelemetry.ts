import {
  createExceptionCapture,
  type ExceptionCaptureContext
} from '../../../../packages/telemetry-sdk/src/exceptionCapture.js';
import { createServerTelemetry } from '../../../../packages/telemetry-sdk/src/server.js';

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
