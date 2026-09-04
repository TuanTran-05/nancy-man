import { describe, expect, it } from 'vitest';

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

  it('flushes before exiting successfully when systemd sends SIGTERM', async () => {
    const process = processDouble() as ReturnType<typeof processDouble> & {
      exit: (code?: number) => never;
    };
    const exits: number[] = [];
    process.exit = ((code = 0) => {
      exits.push(code);
      throw new Error('exit');
    }) as never;
    let flushes = 0;
    installNodeTelemetryLifecycle({
      process,
      captureException: () => undefined,
      flush: async () => {
        flushes += 1;
      }
    });

    await expect(process.handlers.get('SIGTERM')?.()).rejects.toThrow('exit');
    expect(flushes).toBe(1);
    expect(exits).toEqual([0]);
  });
});
