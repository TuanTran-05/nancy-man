import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { createRuntimeTelemetry } from './runtimeTelemetry.js';
import {
  createOpsProcessRuntimeTelemetry,
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot,
  runOpsTelemetryOneShot
} from './oneShot.js';
import {
  captureOpsException as captureSharedOpsException,
  createRuntimeCaptureFacade,
  installOpsRuntimeTelemetry as installSharedOpsRuntimeTelemetry
} from './runtimeCaptureFacade.js';

describe('runtime capture facade binding', () => {
  it('exposes one active binding to package callers', () => {
    const captured: unknown[] = [];
    const uninstall = installSharedOpsRuntimeTelemetry({
      captureException: (error) => {
        captured.push(error);
        return 'EVT_00000000000000000000000003';
      }
    });
    const packageError = new Error('shared package failure');

    captureSharedOpsException(packageError, { code: 'PACKAGE_FAILED', source: 'database' });
    uninstall();

    expect(captured).toEqual([packageError]);
  });

  it('removes a disposed binding without reviving it after nested runtimes stop', () => {
    const facade = createRuntimeCaptureFacade();
    const calls: string[] = [];
    const first = {
      captureException: () => {
        calls.push('first');
        return 'EVT_00000000000000000000000001' as const;
      }
    };
    const second = {
      captureException: () => {
        calls.push('second');
        return 'EVT_00000000000000000000000002' as const;
      }
    };

    const uninstallFirst = facade.install(first);
    const uninstallSecond = facade.install(second);
    uninstallFirst();
    facade.captureException(new Error('active'), { code: 'ACTIVE', source: 'process' });
    uninstallSecond();
    expect(
      facade.captureException(new Error('stopped'), { code: 'STOPPED', source: 'process' })
    ).toBeUndefined();

    expect(calls).toEqual(['second']);
  });

  it('flushes only the active binding and contains hostile flush failures', async () => {
    const facade = createRuntimeCaptureFacade();
    const flushes: string[] = [];
    const uninstallFirst = facade.install({
      captureException: () => undefined,
      flush: async () => {
        flushes.push('first');
      }
    });
    const uninstallSecond = facade.install({
      captureException: () => undefined,
      flush: async () => {
        flushes.push('second');
        throw new Error('transport unavailable');
      }
    });

    await expect(facade.flush()).resolves.toBeUndefined();
    uninstallFirst();
    await expect(facade.flush()).resolves.toBeUndefined();
    uninstallSecond();
    await expect(facade.flush()).resolves.toBeUndefined();

    expect(flushes).toEqual(['second', 'second']);
  });

  it('reuses stable identity and fails open through the bound runtime', async () => {
    const delivered: string[] = [];
    const runtime = createRuntimeTelemetry({
      enabled: true,
      release: '0123456789abcdef0123456789abcdef01234567',
      service: 'test-runtime',
      transport: async (envelope) => {
        delivered.push(envelope.eventId);
      }
    });
    const facade = createRuntimeCaptureFacade();
    const uninstall = facade.install(runtime);
    const error = new Error('database unavailable');

    const first = facade.captureException(error, { code: 'DATABASE_FAILED', source: 'database' });
    const second = facade.captureException(error, { code: 'OUTER_FAILED', source: 'api' });
    await runtime.flush();
    uninstall();

    expect(first).toBe(second);
    expect(delivered).toEqual([first]);

    const uninstallHostile = facade.install({
      captureException: () => {
        throw new Error('telemetry failed');
      }
    });
    expect(() =>
      facade.captureException(new Error('originating failure'), {
        code: 'ORIGINATING_FAILURE',
        source: 'job'
      })
    ).not.toThrow();
    uninstallHostile();
  });

  it('resolves request metadata lazily and contains hostile accessors before runtime capture', () => {
    const facade = createRuntimeCaptureFacade();
    const contexts: Array<Record<string, unknown>> = [];
    const uninstall = facade.install({
      captureException: (_error, context) => {
        contexts.push(context);
        return 'EVT_00000000000000000000000008';
      }
    });

    facade.captureException(new Error('request failed'), {
      code: 'ROUTE_FAILED',
      source: 'api',
      requestId: () => 'REQ_00000000000000000000000000',
      route: () => {
        throw new Error('hostile originalUrl getter');
      },
      method: () => 'GET',
      status: () => 503
    });
    uninstall();

    expect(contexts).toEqual([
      {
        code: 'ROUTE_FAILED',
        source: 'api',
        requestId: 'REQ_00000000000000000000000000',
        method: 'GET',
        status: 503
      }
    ]);
  });

  it('keeps a one-shot runtime bound through capture and flush, then removes its listeners', async () => {
    const order: string[] = [];
    const before = {
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGINT: process.listenerCount('SIGINT')
    };
    const telemetry = {
      captureException: (error: unknown) => {
        order.push(`capture:${error instanceof Error ? error.message : 'unknown'}`);
        return 'EVT_00000000000000000000000016' as const;
      },
      flush: async () => {
        order.push('flush');
      },
      healthy: () => true
    };

    await runOpsTelemetryOneShot({
      telemetry,
      failureContext: { code: 'COMMAND_FAILED', source: 'process', level: 'fatal' },
      run: async () => {
        captureSharedOpsException(new Error('package-boundary'), {
          code: 'PACKAGE_BOUNDARY_FAILED',
          source: 'database'
        });
      }
    });

    captureSharedOpsException(new Error('after-close'), {
      code: 'AFTER_CLOSE',
      source: 'process'
    });
    expect(order).toEqual(['capture:package-boundary', 'flush']);
    expect({
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGINT: process.listenerCount('SIGINT')
    }).toEqual(before);
  });

  it('flushes and terminates a real one-shot process after SIGTERM', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-one-shot-signal-'));
    const executable = join(directory, 'one-shot-signal.mjs');
    try {
      buildSync({
        bundle: true,
        format: 'esm',
        outfile: executable,
        packages: 'external',
        platform: 'node',
        stdin: {
          contents: `
            import { runOpsTelemetryOneShot } from './oneShot.ts';
            await runOpsTelemetryOneShot({
              telemetry: {
                captureException: () => 'EVT_00000000000000000000000020',
                flush: async () => console.log('flushed'),
                healthy: () => true
              },
              failureContext: { code: 'COMMAND_FAILED', source: 'process' },
              run: async () => {
                console.log('ready');
                setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);
                setTimeout(() => console.log('still-alive-after-SIGTERM'), 250);
                await new Promise(() => undefined);
              }
            });
          `,
          loader: 'ts',
          resolveDir: dirname(fileURLToPath(import.meta.url)),
          sourcefile: 'one-shot-signal.ts'
        },
        target: 'node22'
      });

      const child = spawnSync(process.execPath, [executable], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 3_000
      });

      expect(child.error).toBeUndefined();
      expect(child.signal).toBeNull();
      expect(child.status).toBe(0);
      expect(child.stdout).toContain('ready');
      expect(child.stdout).toContain('flushed');
      expect(child.stdout).not.toContain('still-alive-after-SIGTERM');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('captures a one-shot primary failure, preserves its identity, and contains flush failure', async () => {
    const order: string[] = [];
    const failure = new Error('command failed');
    const telemetry = {
      captureException: (error: unknown) => {
        order.push(`capture:${error === failure}`);
        return 'EVT_00000000000000000000000017' as const;
      },
      flush: async () => {
        order.push('flush');
        throw new Error('hostile transport');
      },
      healthy: () => false
    };

    await expect(
      runOpsTelemetryOneShot({
        telemetry,
        failureContext: { code: 'COMMAND_FAILED', source: 'process', level: 'fatal' },
        run: async () => {
          throw failure;
        }
      })
    ).rejects.toBe(failure);

    expect(order).toEqual(['capture:true', 'flush']);
    expect(
      captureSharedOpsException(new Error('after-failure'), {
        code: 'AFTER_FAILURE',
        source: 'process'
      })
    ).toBeUndefined();
  });

  it('runs a terminal one-shot failure handler while bound and can absorb only after flush', async () => {
    const failure = new Error('terminal command failed');
    const order: string[] = [];
    const telemetry = {
      captureException: (error: unknown) => {
        order.push(error === failure ? 'capture' : 'unexpected-capture');
        return 'EVT_00000000000000000000000019' as const;
      },
      flush: async () => {
        order.push('flush');
      },
      healthy: () => true
    };

    await expect(
      runOpsTelemetryOneShot({
        telemetry,
        failureContext: { code: 'TERMINAL_COMMAND_FAILED', source: 'process' },
        run: async () => {
          throw failure;
        },
        onFailure: (error) => {
          expect(error).toBe(failure);
          order.push('handler');
        },
        rethrow: false
      })
    ).resolves.toBeUndefined();

    expect(order).toEqual(['capture', 'handler', 'flush']);
  });

  it('contains an unreportable telemetry-bootstrap failure through the explicit terminal handler', async () => {
    const bootstrapFailure = new Error('telemetry credential unavailable');
    const handled: unknown[] = [];

    await expect(
      runConfiguredOpsTelemetryOneShot({
        createTelemetry: async () => {
          throw bootstrapFailure;
        },
        failureContext: { code: 'COMMAND_FAILED', source: 'process' },
        run: async () => {
          throw new Error('must not run');
        },
        onFailure: (error) => {
          handled.push(error);
        },
        rethrow: false
      })
    ).resolves.toBeUndefined();

    expect(handled).toEqual([bootstrapFailure]);
  });

  it('creates a service-scoped configured runtime and a fail-open disabled runtime', async () => {
    const envelopes: Array<Record<string, unknown>> = [];
    const telemetry = createOpsProcessRuntimeTelemetry({
      config: {
        enabled: true,
        endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/server',
        keyId: 'ops-runtime-test',
        hmacSecretReference: 'ops-telemetry-hmac',
        release: '0123456789abcdef0123456789abcdef01234567',
        spoolRoot: '/tmp/ops-telemetry-test',
        spoolDirectory: '/tmp/ops-telemetry-test'
      },
      hmacSecret: 'a'.repeat(32),
      service: 'edutrack-ops-command-test',
      spoolName: 'command-test',
      spool: {
        enqueue: async (envelope) => {
          envelopes.push(envelope);
          return { queued: true, evicted: 0 };
        },
        flush: async () => ({ delivered: 0, deferred: 0 })
      }
    });
    telemetry.captureException(new Error('command failed'), {
      code: 'COMMAND_FAILED',
      source: 'process'
    });
    await telemetry.flush();

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      error: { code: 'COMMAND_FAILED' },
      context: { service: 'edutrack-ops-command-test' }
    });

    const disabled = createOpsProcessRuntimeTelemetry({
      config: { enabled: false },
      service: 'edutrack-ops-command-test',
      spoolName: 'command-test'
    });
    expect(disabled.captureException(new Error('disabled'), { code: 'DISABLED' })).toBeUndefined();
    expect(disabled.healthy()).toBe(true);
  });

  it('resolves an environment-configured process credential without exposing it to callers', async () => {
    const requested: string[] = [];
    const queued: Array<Record<string, unknown>> = [];
    const telemetry = await createOpsProcessRuntimeTelemetryFromEnvironment({
      environment: {
        OPS_TELEMETRY_ENABLED: 'true',
        OPS_TELEMETRY_INGEST_URL: 'https://man.thienuy.edu.vn/api/v1/ingest/server',
        OPS_TELEMETRY_KEY_ID: 'ops-runtime-test',
        OPS_TELEMETRY_HMAC_SECRET_REFERENCE: 'ops-telemetry-hmac',
        OPS_TELEMETRY_RELEASE: '0123456789abcdef0123456789abcdef01234567',
        OPS_TELEMETRY_SPOOL_ROOT: '/tmp/ops-telemetry-test',
        OPS_TELEMETRY_SPOOL_DIRECTORY: '/tmp/ops-telemetry-test'
      },
      resolveHmacSecret: async (reference) => {
        requested.push(reference);
        return 'b'.repeat(32);
      },
      service: 'edutrack-ops-environment-command',
      spoolName: 'environment-command',
      spool: {
        enqueue: async (envelope) => {
          queued.push(envelope);
          return { queued: true, evicted: 0 };
        },
        flush: async () => ({ delivered: 0, deferred: 0 })
      }
    });

    telemetry.captureException(new Error('environment command failed'), {
      code: 'ENVIRONMENT_COMMAND_FAILED',
      source: 'process'
    });
    await telemetry.flush();

    expect(requested).toEqual(['ops-telemetry-hmac']);
    expect(queued).toHaveLength(1);
  });
});
