import { createBrowserTelemetry } from '../../../../../packages/telemetry-sdk/src/browser.js';
import {
  BrowserSpool,
  createIndexedDbBrowserSpoolStore,
  createResilientBrowserSpoolStore,
  type BrowserSpoolRecord,
  type BrowserSpoolStore
} from '../../../../../packages/telemetry-sdk/src/browserSpool.js';
import {
  createBrowserExceptionCapture,
  type BrowserExceptionCaptureContext
} from '../../../../../packages/telemetry-sdk/src/exceptionCapture.browser.js';
import type { TelemetryEnvelopeV1 } from '../../../../../packages/contracts/src/telemetry.js';
export { readOpsBrowserTelemetryConfig, type OpsBrowserTelemetryConfig } from './config.js';

type BrowserCaptureContext = Omit<BrowserExceptionCaptureContext, 'eventId'>;

export type OpsBrowserRuntimeTelemetry = {
  captureException: (error: unknown, context: BrowserCaptureContext) => `EVT_${string}` | undefined;
  flush: () => Promise<void>;
  healthy: () => boolean;
};

function createMemoryBrowserSpoolStore(): BrowserSpoolStore {
  const records = new Map<string, BrowserSpoolRecord>();
  return {
    list: async () => [...records.values()],
    put: async (record) => {
      records.set(record.idempotencyKey, record);
    },
    remove: async (idempotencyKey) => {
      records.delete(idempotencyKey);
    }
  };
}

export function createOpsBrowserRuntimeTelemetry(input: {
  endpoint: string;
  projectKey: string;
  release: string;
  fetch?: typeof globalThis.fetch;
  spoolStore?: BrowserSpoolStore;
}): OpsBrowserRuntimeTelemetry {
  const request = input.fetch ?? globalThis.fetch;
  let degraded = false;
  const fallbackStore = createMemoryBrowserSpoolStore();
  let primaryStore = input.spoolStore;
  if (!primaryStore) {
    try {
      primaryStore = createIndexedDbBrowserSpoolStore({
        databaseName: 'edutrack-ops-web-telemetry'
      });
    } catch {
      degraded = true;
    }
  }
  const spoolStore = primaryStore
    ? createResilientBrowserSpoolStore(primaryStore, fallbackStore, () => {
        degraded = true;
      })
    : fallbackStore;
  const spool = new BrowserSpool({ store: spoolStore });
  const deliver = async (envelope: TelemetryEnvelopeV1) => {
    const response = await request(input.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ops-Project-Key': input.projectKey
      },
      body: JSON.stringify(envelope)
    });
    if (response.status !== 202) {
      throw new Error(`Browser telemetry ingest failed with ${response.status}`);
    }
    const acknowledgment = (await response.text()).trim();
    if (!acknowledgment) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(acknowledgment) as unknown;
    } catch {
      throw new Error('Browser telemetry ingest returned malformed acknowledgment');
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { accepted?: unknown }).accepted !== true ||
      (parsed as { eventId?: unknown }).eventId !== envelope.eventId
    ) {
      throw new Error('Browser telemetry ingest returned mismatched acknowledgment');
    }
  };
  let flushing: Promise<{ delivered: number; deferred: number }> | undefined;
  const flushSpool = (): Promise<{ delivered: number; deferred: number }> => {
    flushing ??= spool
      .flush(async (envelope) => {
        await deliver(envelope);
        return { acknowledgedIdempotencyKey: envelope.idempotencyKey };
      })
      .then((result) => {
        if (result.deferred > 0) degraded = true;
        return result;
      })
      .finally(() => {
        flushing = undefined;
      });
    return flushing;
  };
  const browserTelemetry = createBrowserTelemetry({
    release: input.release,
    service: 'edutrack-ops-web-browser',
    transport: deliver,
    spool: {
      enqueue: async (envelope) => {
        const result = await spool.enqueue(envelope);
        if (result.evicted > 0) {
          await spool.recordEvictionDiagnostic(envelope, result.evicted);
        }
        return result;
      },
      flush: async () => flushSpool()
    }
  });
  const capture = createBrowserExceptionCapture({
    capture: async (error, context) => {
      await browserTelemetry.captureException(error, context);
    },
    onCaptureFailure: () => {
      degraded = true;
    }
  });

  return {
    captureException: capture.captureOnce,
    flush: async () => {
      try {
        await capture.flush();
        await flushSpool();
      } catch {
        degraded = true;
      }
    },
    healthy: () => !degraded
  };
}

type BrowserLifecycleTargets = {
  window: Window;
  document: Document;
};

const runtimeBindings: Array<{
  runtime: OpsBrowserRuntimeTelemetry;
  token: symbol;
}> = [];
type TargetRuntimeBinding = (typeof runtimeBindings)[number];
const listenerBindings = new WeakMap<
  Window,
  { bindings: TargetRuntimeBinding[]; remove: () => void }
>();

function activeRuntime(): OpsBrowserRuntimeTelemetry | undefined {
  return runtimeBindings.at(-1)?.runtime;
}

export function captureBrowserException(
  error: unknown,
  context: BrowserCaptureContext
): `EVT_${string}` | undefined {
  try {
    return activeRuntime()?.captureException(error, context);
  } catch {
    return undefined;
  }
}

function currentRoute(target: Window): string | undefined {
  try {
    return target.location.pathname;
  } catch {
    return undefined;
  }
}

function activeRuntimeFor(target: Window): OpsBrowserRuntimeTelemetry | undefined {
  return listenerBindings.get(target)?.bindings.at(-1)?.runtime;
}

function captureForTarget(
  target: Window,
  error: unknown,
  context: BrowserCaptureContext
): `EVT_${string}` | undefined {
  try {
    return activeRuntimeFor(target)?.captureException(error, context);
  } catch {
    return undefined;
  }
}

function flushRuntimeFor(target: Window): void {
  try {
    const pending = activeRuntimeFor(target)?.flush();
    if (pending) void pending.catch(() => undefined);
  } catch {
    // Browser telemetry lifecycle must remain fail-open.
  }
}

export function installOpsBrowserRuntimeTelemetry(
  runtime: OpsBrowserRuntimeTelemetry,
  targets: BrowserLifecycleTargets = { window, document }
): () => void {
  const binding = { runtime, token: Symbol('opsBrowserRuntimeTelemetry') };
  runtimeBindings.push(binding);

  const currentListeners = listenerBindings.get(targets.window);
  if (currentListeners) {
    currentListeners.bindings.push(binding);
  } else {
    const onError = (event: ErrorEvent): void => {
      const error = event.error ?? new Error(event.message || 'Unknown window error');
      captureForTarget(targets.window, error, {
        code: 'OPS_WEB_WINDOW_ERROR',
        source: 'browser',
        ...(currentRoute(targets.window) ? { route: currentRoute(targets.window) } : {})
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      captureForTarget(targets.window, event.reason, {
        code: 'OPS_WEB_UNHANDLED_REJECTION',
        source: 'browser',
        ...(currentRoute(targets.window) ? { route: currentRoute(targets.window) } : {})
      });
    };
    const onVisibilityChange = (): void => {
      if (targets.document.visibilityState === 'hidden') flushRuntimeFor(targets.window);
    };
    const onFlush = (): void => flushRuntimeFor(targets.window);
    targets.window.addEventListener('error', onError);
    targets.window.addEventListener('unhandledrejection', onUnhandledRejection);
    targets.window.addEventListener('online', onFlush);
    targets.window.addEventListener('pagehide', onFlush);
    targets.document.addEventListener('visibilitychange', onVisibilityChange);
    listenerBindings.set(targets.window, {
      bindings: [binding],
      remove: () => {
        targets.window.removeEventListener('error', onError);
        targets.window.removeEventListener('unhandledrejection', onUnhandledRejection);
        targets.window.removeEventListener('online', onFlush);
        targets.window.removeEventListener('pagehide', onFlush);
        targets.document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    });
  }

  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    const index = runtimeBindings.findIndex((candidate) => candidate.token === binding.token);
    if (index >= 0) runtimeBindings.splice(index, 1);
    const listeners = listenerBindings.get(targets.window);
    if (!listeners) return;
    const targetIndex = listeners.bindings.findIndex(
      (candidate) => candidate.token === binding.token
    );
    if (targetIndex >= 0) listeners.bindings.splice(targetIndex, 1);
    if (listeners.bindings.length > 0) return;
    listeners.remove();
    listenerBindings.delete(targets.window);
  };
}
