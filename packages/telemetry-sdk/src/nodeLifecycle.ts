import { normalizeException } from './exceptionCapture.js';

type NodeProcess = {
  on: (event: string, listener: (...arguments_: unknown[]) => void | Promise<void>) => unknown;
  exit?: (code?: number) => never;
  exitCode?: number;
};

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

export function installNodeTelemetryLifecycle(input: {
  process?: NodeProcess;
  captureException: (
    error: unknown,
    context: {
      code: 'PROCESS_UNCAUGHT_EXCEPTION' | 'PROCESS_UNHANDLED_REJECTION';
      source: 'process';
      level: 'fatal';
    }
  ) => unknown;
  flush: () => Promise<void>;
  flushTimeoutMs?: number;
}): void {
  const process = input.process ?? (globalThis.process as unknown as NodeProcess);
  if (installedProcesses.has(process as object)) return;
  installedProcesses.add(process as object);
  const timeoutMs = Math.min(Math.max(input.flushTimeoutMs ?? 5_000, 100), 10_000);

  const reportAndFail = async (
    error: unknown,
    code: 'PROCESS_UNCAUGHT_EXCEPTION' | 'PROCESS_UNHANDLED_REJECTION'
  ): Promise<void> => {
    try {
      input.captureException(normalizeException(error), { code, source: 'process', level: 'fatal' });
    } catch {
      // A lifecycle safety net cannot throw from another process error handler.
    }
    await boundedFlush(input.flush, timeoutMs);
    process.exitCode = 1;
  };

  process.on('uncaughtException', (error) => reportAndFail(error, 'PROCESS_UNCAUGHT_EXCEPTION'));
  process.on('unhandledRejection', (reason) =>
    reportAndFail(reason, 'PROCESS_UNHANDLED_REJECTION')
  );
  const flushAndExit = async (): Promise<void> => {
    await boundedFlush(input.flush, timeoutMs);
    if (process.exit) process.exit(0);
  };
  process.on('SIGTERM', flushAndExit);
  process.on('SIGINT', flushAndExit);
}
