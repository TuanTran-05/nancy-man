import { createExceptionCapture, type ExceptionCaptureContext } from './exceptionCapture.js';
import { createServerTelemetry } from './server.js';
import { type ServerTelemetryRuntimeConfig } from './serverRuntimeConfig.js';
import { ServerSpool } from './serverSpool.js';
import { createSignedServerTransport } from './serverTransport.js';

type RuntimeTelemetryContext = Omit<ExceptionCaptureContext, 'eventId'> & {
  method?: string;
  status?: number;
};

type ServerTelemetryInput = Parameters<typeof createServerTelemetry>[0];

export type RuntimeTelemetry = {
  captureException: (
    error: unknown,
    context: RuntimeTelemetryContext
  ) => `EVT_${string}` | undefined;
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

  let healthy = true;
  const spool = input.spool
    ? {
        enqueue: async (
          ...arguments_: Parameters<NonNullable<ServerTelemetryInput['spool']>['enqueue']>
        ) => {
          try {
            return await input.spool!.enqueue(...arguments_);
          } catch (error) {
            healthy = false;
            throw error;
          }
        },
        flush: async (
          ...arguments_: Parameters<NonNullable<ServerTelemetryInput['spool']>['flush']>
        ) => {
          try {
            return await input.spool!.flush(...arguments_);
          } catch (error) {
            healthy = false;
            throw error;
          }
        }
      }
    : undefined;
  const reporter = createServerTelemetry({
    release: input.release,
    service: input.service,
    transport: input.transport,
    ...(spool ? { spool } : {})
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
    flush: async () => {
      await capture.flush();
      await reporter.flush();
    },
    healthy: () => healthy
  };
}

export function createConfiguredRuntimeTelemetry(input: {
  config: Extract<ServerTelemetryRuntimeConfig, { enabled: true }>;
  hmacSecret: string;
  service: string;
  spoolDirectory?: string;
  spool?: ServerTelemetryInput['spool'];
  fetch?: typeof globalThis.fetch;
}): RuntimeTelemetry {
  const spool =
    input.spool ??
    new ServerSpool({
      allowedRoot: input.config.spoolRoot,
      spoolDirectory: input.spoolDirectory ?? input.config.spoolDirectory
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

export function startRuntimeTelemetryMaintenance(input: {
  flush: () => Promise<void>;
  intervalMs?: number;
  setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
}): () => void {
  const intervalMs = input.intervalMs ?? 30_000;
  const flush = () => void input.flush().catch(() => undefined);
  flush();
  const schedule = input.setInterval ?? setInterval;
  const cancel = input.clearInterval ?? clearInterval;
  const timer = schedule(flush, intervalMs);
  return () => cancel(timer);
}
