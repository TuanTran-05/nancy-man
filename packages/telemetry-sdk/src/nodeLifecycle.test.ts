import { describe, expect, it, vi } from 'vitest';

import { createExceptionCapture } from './exceptionCapture.js';
import { installNodeTelemetryLifecycle } from './nodeLifecycle.js';

type Handler = (...arguments_: unknown[]) => void | Promise<void>;

function processDouble(): {
  on: (event: string, handler: Handler) => void;
  handlers: Map<string, Handler>;
  exitCode?: number;
} {
  const handlers = new Map<string, Handler>();
  return {
    on: (event, handler) => {
      handlers.set(event, handler);
    },
    handlers
  };
}

describe('node telemetry lifecycle', () => {
  it('waits for an asynchronous capture before flushing and exiting', async () => {
    const process = processDouble();
    const lifecycle: string[] = [];
    let releaseCapture: (() => void) | undefined;

    installNodeTelemetryLifecycle({
      process,
      capture: async () => {
        lifecycle.push('capture');
        await new Promise<void>((resolve) => {
          releaseCapture = resolve;
        });
      },
      flush: async () => {
        lifecycle.push('flush');
      },
      exit: (code) => {
        lifecycle.push(`exit:${code}`);
      }
    });

    const handled = process.handlers.get('unhandledRejection')?.(new Error('lost promise'));

    expect(lifecycle).toEqual(['capture']);
    releaseCapture?.();
    await handled;

    expect(lifecycle).toEqual(['capture', 'flush', 'exit:1']);
  });

  it('continues to flush and terminate after a capture exceeds the lifecycle deadline', async () => {
    vi.useFakeTimers();
    try {
      const process = processDouble();
      const lifecycle: string[] = [];
      let completed = false;

      installNodeTelemetryLifecycle({
        process,
        capture: () => {
          lifecycle.push('capture');
          return new Promise<void>(() => undefined);
        },
        flush: async () => {
          lifecycle.push('flush');
        },
        flushTimeoutMs: 100,
        exit: (code) => {
          lifecycle.push(`exit:${code}`);
        }
      });

      const handled = process.handlers.get('unhandledRejection')?.(new Error('lost promise'));
      void Promise.resolve(handled).then(() => {
        completed = true;
      });

      await vi.advanceTimersByTimeAsync(100);

      expect(completed).toBe(true);
      expect(lifecycle).toEqual(['capture', 'flush', 'exit:1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses an existing event ID without duplicate lifecycle delivery', async () => {
    const process = processDouble();
    const reports: string[] = [];
    const lifecycleContexts: Array<{
      code: string;
      eventId?: string;
      level: string;
      source: string;
    }> = [];
    const exceptionCapture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000006',
      capture: (_error, context) => {
        reports.push(context.eventId);
      }
    });
    const error = new Error('provider failed');

    exceptionCapture.captureOnce(error, { code: 'PROVIDER_FAILED' });
    installNodeTelemetryLifecycle({
      process,
      capture: (capturedError, context) => {
        lifecycleContexts.push(context);
        return exceptionCapture.captureOnce(capturedError, context);
      },
      flush: async () => undefined
    });

    await process.handlers.get('uncaughtException')?.(error);

    expect(lifecycleContexts).toEqual([]);
    expect(reports).toEqual(['EVT_00000000000000000000000006']);
  });

  it('accepts the Task 1 capture lifecycle surface and delegates fatal exit after flush', async () => {
    const process = processDouble();
    const events: string[] = [];
    const lifecycle: string[] = [];

    installNodeTelemetryLifecycle({
      process,
      capture: (error, context) => {
        events.push(`${context.code}:${(error as Error).message}`);
      },
      flush: async () => {
        lifecycle.push('flush');
      },
      exit: (code) => {
        lifecycle.push(`exit:${code}`);
      }
    });

    await process.handlers.get('unhandledRejection')?.(new Error('lost promise'));

    expect(events).toEqual(['PROCESS_UNHANDLED_REJECTION:lost promise']);
    expect(lifecycle).toEqual(['flush', 'exit:1']);
  });

  it('captures an unhandled rejection, flushes telemetry, and marks the process failed', async () => {
    const process = processDouble();
    const captured: Array<{ error: Error; code: string }> = [];
    let flushes = 0;

    installNodeTelemetryLifecycle({
      process,
      captureException: (error, context) => {
        captured.push({ error: error as Error, code: context.code });
      },
      flush: async () => {
        flushes += 1;
      }
    });

    await process.handlers.get('unhandledRejection')?.(new Error('lost promise'));

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ code: 'PROCESS_UNHANDLED_REJECTION' });
    expect(captured[0]?.error).toMatchObject({ message: 'lost promise' });
    expect(flushes).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  it('installs one set of handlers for the same process object', () => {
    const process = processDouble();
    const input = {
      process,
      captureException: () => undefined,
      flush: async () => undefined
    };

    installNodeTelemetryLifecycle(input);
    const firstHandlers = [...process.handlers.entries()];
    installNodeTelemetryLifecycle(input);

    expect(process.handlers).toHaveLength(firstHandlers.length);
    expect(process.handlers.has('uncaughtException')).toBe(true);
    expect(process.handlers.has('unhandledRejection')).toBe(true);
  });

  it('flushes without taking termination ownership when systemd sends SIGTERM', async () => {
    const process = processDouble() as ReturnType<typeof processDouble> & {
      exit: (code?: number) => never;
    };
    const exits: number[] = [];
    process.exit = ((code = 0) => {
      exits.push(code);
    }) as never;
    let flushes = 0;
    installNodeTelemetryLifecycle({
      process,
      captureException: () => undefined,
      flush: async () => {
        flushes += 1;
      }
    });

    await expect(process.handlers.get('SIGTERM')?.()).resolves.toBeUndefined();
    expect(flushes).toBe(1);
    expect(exits).toEqual([]);
  });
});
