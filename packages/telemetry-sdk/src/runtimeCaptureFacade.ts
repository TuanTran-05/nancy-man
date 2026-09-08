type RuntimeCaptureContext = {
  code: string;
  source?: 'api' | 'browser' | 'database' | 'document_store' | 'job' | 'provider' | 'process';
  level?: 'fatal' | 'error' | 'warning';
  requestId?: `REQ_${string}`;
  route?: string;
  method?: string;
  status?: number;
  traceId?: string;
  componentStack?: string;
  tags?: Record<string, string>;
};
type CaptureRuntime = {
  captureException: (error: unknown, context: RuntimeCaptureContext) => `EVT_${string}` | undefined;
  flush?: () => Promise<void>;
};
type DeferredValue<T> = T | (() => unknown);
export type OpsRuntimeCaptureContext = Omit<
  RuntimeCaptureContext,
  'method' | 'requestId' | 'route' | 'status'
> & {
  method?: DeferredValue<string>;
  requestId?: DeferredValue<`REQ_${string}`>;
  route?: DeferredValue<string>;
  status?: DeferredValue<number>;
};
type CaptureArguments = [error: unknown, context: OpsRuntimeCaptureContext];
type CaptureResult = ReturnType<CaptureRuntime['captureException']>;

function resolveDeferred<T>(
  value: DeferredValue<T> | undefined,
  valid: (candidate: unknown) => candidate is T
): T | undefined {
  let candidate: unknown;
  try {
    candidate = typeof value === 'function' ? (value as () => unknown)() : value;
  } catch {
    return undefined;
  }
  return valid(candidate) ? candidate : undefined;
}

function resolveCaptureContext(context: OpsRuntimeCaptureContext): RuntimeCaptureContext {
  const resolved = { ...context } as Record<string, unknown>;
  for (const property of ['method', 'requestId', 'route', 'status']) delete resolved[property];
  const method = resolveDeferred(
    context.method,
    (value): value is string => typeof value === 'string'
  );
  const requestId = resolveDeferred(
    context.requestId,
    (value): value is `REQ_${string}` => typeof value === 'string' && value.startsWith('REQ_')
  );
  const route = resolveDeferred(
    context.route,
    (value): value is string => typeof value === 'string'
  );
  const status = resolveDeferred(
    context.status,
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  return {
    ...(resolved as RuntimeCaptureContext),
    ...(method === undefined ? {} : { method }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(route === undefined ? {} : { route }),
    ...(status === undefined ? {} : { status })
  };
}

export async function flushRuntimeTelemetryFailOpen(
  runtime: Partial<Pick<CaptureRuntime, 'flush'>> | undefined
): Promise<void> {
  try {
    await runtime?.flush?.();
  } catch {
    // Telemetry delivery is fail-open and cannot report through itself.
  }
}

export function createRuntimeCaptureFacade(): {
  captureException: (...arguments_: CaptureArguments) => CaptureResult;
  flush: () => Promise<void>;
  install: (runtime: CaptureRuntime) => () => void;
} {
  const bindings: Array<{ runtime: CaptureRuntime; token: symbol }> = [];

  return {
    captureException: (error, context) => {
      const active = bindings.at(-1);
      if (!active) return undefined;
      try {
        return active.runtime.captureException(error, resolveCaptureContext(context));
      } catch {
        return undefined;
      }
    },
    flush: async () => flushRuntimeTelemetryFailOpen(bindings.at(-1)?.runtime),
    install: (runtime) => {
      const binding = { runtime, token: Symbol('runtimeTelemetryBinding') };
      bindings.push(binding);
      let installed = true;
      return () => {
        if (!installed) return;
        installed = false;
        const index = bindings.findIndex((candidate) => candidate.token === binding.token);
        if (index >= 0) bindings.splice(index, 1);
      };
    }
  };
}

const opsRuntimeCaptureFacade = createRuntimeCaptureFacade();

export const captureOpsException = opsRuntimeCaptureFacade.captureException;
export const flushOpsRuntimeTelemetry = opsRuntimeCaptureFacade.flush;
export const installOpsRuntimeTelemetry = opsRuntimeCaptureFacade.install;
