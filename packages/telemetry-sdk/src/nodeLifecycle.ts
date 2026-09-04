import { normalizeException } from './exceptionCapture.js';

type NodeProcess = {
  on: (event: string, listener: (...arguments_: unknown[]) => void | Promise<void>) => unknown;
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

const installedProcesses = new WeakSet<object>();

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

export function installNodeTelemetryLifecycle(input: NodeTelemetryLifecycleInput): void {
  const process = input.process ?? (globalThis.process as unknown as NodeProcess);
  const capture = input.capture ?? input.captureException;
  if (!capture) return;
  if (installedProcesses.has(process as object)) return;
  installedProcesses.add(process as object);
  const timeoutMs = Math.min(Math.max(input.flushTimeoutMs ?? 5_000, 100), 10_000);

  const reportAndFail = async (
    error: unknown,
    code: 'PROCESS_UNCAUGHT_EXCEPTION' | 'PROCESS_UNHANDLED_REJECTION'
  ): Promise<void> => {
    try {
      capture(normalizeException(error), { code, source: 'process', level: 'fatal' });
    } catch {
      // A lifecycle safety net cannot throw from another process error handler.
    }
    await boundedFlush(input.flush, timeoutMs);
    if (input.exit) input.exit(1);
    else process.exitCode = 1;
  };

  process.on('uncaughtException', (error) => reportAndFail(error, 'PROCESS_UNCAUGHT_EXCEPTION'));
  process.on('unhandledRejection', (reason) =>
    reportAndFail(reason, 'PROCESS_UNHANDLED_REJECTION')
  );
  const flushAndExit = async (): Promise<void> => {
    await boundedFlush(input.flush, timeoutMs);
    if (input.exit) input.exit(0);
    else process.exit?.(0);
  };
  process.on('SIGTERM', flushAndExit);
  process.on('SIGINT', flushAndExit);
}
