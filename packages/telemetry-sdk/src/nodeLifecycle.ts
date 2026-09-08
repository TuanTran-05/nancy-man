import { normalizeException } from './exceptionCapture.js';

type NodeProcess = {
  on: (event: string, listener: (...arguments_: unknown[]) => void | Promise<void>) => unknown;
  off?: (event: string, listener: (...arguments_: unknown[]) => void | Promise<void>) => unknown;
  removeListener?: (
    event: string,
    listener: (...arguments_: unknown[]) => void | Promise<void>
  ) => unknown;
  exit?: (code?: number) => void;
  exitCode?: number;
};

type LifecycleCapture = (
  error: unknown,
  context: {
    code: 'PROCESS_UNCAUGHT_EXCEPTION' | 'PROCESS_UNHANDLED_REJECTION';
    source: 'process';
    level: 'fatal';
  }
) => unknown;

type NodeTelemetryLifecycleInput = {
  process?: NodeProcess;
  flush: () => Promise<void>;
  flushTimeoutMs?: number;
  exit?: (code?: number) => void;
} & (
  | { capture: LifecycleCapture; captureException?: LifecycleCapture }
  | { capture?: LifecycleCapture; captureException: LifecycleCapture }
);

type LifecycleBinding = {
  capture: LifecycleCapture;
  exit?: (code?: number) => void;
  flush: () => Promise<void>;
  timeoutMs: number;
  token: symbol;
};

type InstalledLifecycle = {
  bindings: LifecycleBinding[];
  listeners: Map<string, (...arguments_: unknown[]) => void | Promise<void>>;
};

const installedProcesses = new WeakMap<object, InstalledLifecycle>();

function boundedFlush(flush: () => Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    void flush()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout);
        resolve();
      });
  });
}

function boundedCapture(capture: () => unknown, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    try {
      void Promise.resolve(capture())
        .catch(() => undefined)
        .finally(finish);
    } catch {
      finish();
    }
  });
}

export function installNodeTelemetryLifecycle(input: NodeTelemetryLifecycleInput): () => void {
  const process = input.process ?? (globalThis.process as unknown as NodeProcess);
  const capture = input.capture ?? input.captureException;
  if (!capture) return () => undefined;
  const timeoutMs = Math.min(Math.max(input.flushTimeoutMs ?? 5_000, 100), 10_000);
  const binding: LifecycleBinding = {
    capture,
    flush: input.flush,
    timeoutMs,
    token: Symbol('nodeTelemetryLifecycle'),
    ...(input.exit ? { exit: input.exit } : {})
  };
  let installed = installedProcesses.get(process as object);
  if (!installed) {
    installed = { bindings: [], listeners: new Map() };
    const activeBinding = (): LifecycleBinding | undefined => installed?.bindings.at(-1);
    const reportAndFail = async (
      error: unknown,
      code: 'PROCESS_UNCAUGHT_EXCEPTION' | 'PROCESS_UNHANDLED_REJECTION'
    ): Promise<void> => {
      const active = activeBinding();
      if (!active) return;
      try {
        const exception = normalizeException(error);
        await boundedCapture(
          () => active.capture(exception, { code, source: 'process', level: 'fatal' }),
          active.timeoutMs
        );
      } catch {
        // A lifecycle safety net cannot throw from another process error handler.
      }
      await boundedFlush(active.flush, active.timeoutMs);
      if (active.exit) active.exit(1);
      else process.exitCode = 1;
    };
    const uncaughtException = (error: unknown) =>
      reportAndFail(error, 'PROCESS_UNCAUGHT_EXCEPTION');
    const unhandledRejection = (reason: unknown) =>
      reportAndFail(reason, 'PROCESS_UNHANDLED_REJECTION');
    const flushAndExit = async (): Promise<void> => {
      const active = activeBinding();
      if (!active) return;
      await boundedFlush(active.flush, active.timeoutMs);
      if (active.exit) active.exit(0);
    };
    installed.listeners.set('uncaughtException', uncaughtException);
    installed.listeners.set('unhandledRejection', unhandledRejection);
    installed.listeners.set('SIGTERM', flushAndExit);
    installed.listeners.set('SIGINT', flushAndExit);
    installedProcesses.set(process as object, installed);
    for (const [event, listener] of installed.listeners) process.on(event, listener);
  }
  installed.bindings.push(binding);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const current = installedProcesses.get(process as object);
    if (!current) return;
    const index = current.bindings.findIndex((candidate) => candidate.token === binding.token);
    if (index >= 0) current.bindings.splice(index, 1);
    if (current.bindings.length > 0) return;
    const remove = process.off ?? process.removeListener;
    if (!remove) return;
    for (const [event, listener] of current.listeners) remove.call(process, event, listener);
    installedProcesses.delete(process as object);
  };
}
