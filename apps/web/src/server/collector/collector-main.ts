import { readFileSync } from 'node:fs';

import { loadCollectorConfig } from '../config.js';
import { createOpsStore } from '../storage/store.js';
import { runCollectorCycle, type CollectorDeps } from './collector.js';
import { createAlertService } from '../alerts/alertService.js';
import { resolveZaloRecipients } from '../alerts/recipientResolver.js';
import { startSystemdWatchdog } from '../systemdNotify.js';
import { createBeszelClient } from '../beszel/client.js';
import { createBeszelProbe } from '../beszel/probe.js';
import {
  createRuntimeTelemetry,
  startRuntimeTelemetryMaintenance
} from '../../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
import { installNodeTelemetryLifecycle } from '../../../../../packages/telemetry-sdk/src/nodeLifecycle.js';
import {
  captureOpsException,
  createCollectorRuntimeTelemetry,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry
} from '../telemetry/runtimeTelemetry.js';

function isTransientSqliteLock(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^SQLITE_(?:BUSY|LOCKED)(?:_|$)/u.test(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function startCollectorLoop(input: {
  cycle: () => Promise<void>;
  watchdog: { progress: () => void; stop: () => void };
  schedule: (callback: () => void) => () => void;
  onFailure: (error: unknown) => void;
}): Promise<{ stop: () => void }> {
  let stopped = false;
  let running = false;
  let cancelScheduledCycle: () => void = () => undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelScheduledCycle();
    input.watchdog.stop();
  };
  const runScheduledCycle = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await input.cycle();
      if (!stopped) input.watchdog.progress();
    } catch (error) {
      captureOpsException(error, {
        code: 'COLLECTOR_CYCLE_FAILED',
        source: 'job',
        status: 500
      });
      const transientLock = isTransientSqliteLock(error);
      if (transientLock) {
        if (!stopped) input.watchdog.progress();
        return;
      }
      try {
        input.onFailure(error);
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'job',
          status: 500
        });
        // A reporter failure must not leave the collector interval running.
      } finally {
        stop();
      }
    } finally {
      running = false;
    }
  };

  try {
    await input.cycle();
    input.watchdog.progress();
  } catch (error) {
    captureOpsException(error, {
      code: 'COLLECTOR_CYCLE_FAILED',
      source: 'job',
      status: 500
    });
    const transientLock = isTransientSqliteLock(error);
    if (!transientLock) throw error;
    input.watchdog.progress();
  }
  cancelScheduledCycle = input.schedule(() => {
    void runScheduledCycle();
  });
  return { stop };
}

export async function startCollector(): Promise<{ close: () => Promise<void> }> {
  const config = loadCollectorConfig(process.env);
  const telemetryHmac = config.telemetry?.enabled
    ? readFileSync(config.telemetryHmacFile ?? '', 'utf8').trim()
    : undefined;
  if (config.telemetry?.enabled && !telemetryHmac) {
    throw new Error('Ops collector telemetry credential is unavailable');
  }
  const telemetry = config.telemetry?.enabled
    ? createCollectorRuntimeTelemetry({ config: config.telemetry, hmacSecret: telemetryHmac! })
    : createRuntimeTelemetry({
        enabled: false,
        release: '0000000000000000000000000000000000000000',
        service: 'edutrack-ops-collector',
        transport: async () => undefined
      });
  const stopTelemetryMaintenance = startRuntimeTelemetryMaintenance({ flush: telemetry.flush });
  const disposeRuntimeTelemetry = installOpsRuntimeTelemetry(telemetry);
  const disposeNodeTelemetryLifecycle = installNodeTelemetryLifecycle({
    captureException: captureOpsException,
    flush: telemetry.flush,
    exit: (code) => process.exit(code)
  });
  let loop: { stop: () => void } | undefined;
  let store: CollectorDeps['store'] | undefined;
  let closing: Promise<void> | undefined;
  const onSignal = (): void => {
    void stopRuntimeTelemetry().catch((error) => {
      captureOpsException(error, {
        code: 'UNHANDLED_PROMISE_REJECTION',
        source: 'job',
        status: 500
      });
      return undefined;
    });
  };
  const stopRuntimeTelemetry = (
    hasPrimaryFailure = false,
    primaryFailure?: unknown
  ): Promise<void> => {
    closing ??= (async () => {
      let hasFailure = hasPrimaryFailure;
      let firstFailure = primaryFailure;
      const rememberCleanupFailure = (error: unknown, code: string): void => {
        captureOpsException(error, { code, source: 'process' });
        if (!hasFailure) {
          hasFailure = true;
          firstFailure = error;
        }
      };
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      try {
        loop?.stop();
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'job',
          status: 500
        });
        rememberCleanupFailure(error, 'COLLECTOR_LOOP_CLOSE_FAILED');
      }
      try {
        store?.getDatabaseForBackup().close();
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'job',
          status: 500
        });
        rememberCleanupFailure(error, 'COLLECTOR_STORE_CLOSE_FAILED');
      }
      stopTelemetryMaintenance();
      try {
        await flushRuntimeTelemetryFailOpen(telemetry);
      } finally {
        disposeNodeTelemetryLifecycle();
        disposeRuntimeTelemetry();
      }
      if (hasFailure) throw firstFailure;
    })();
    return closing;
  };
  try {
    const beszelProbe = config.beszel.enabled
      ? createBeszelProbe(createBeszelClient(config.beszel))
      : undefined;
    const deps: CollectorDeps = {
      config,
      store: createOpsStore(config.dbPath, undefined, config.zaloRecipientKey, {
        busyTimeoutMs: 1_000
      }),
      histories: new Map(),
      beszelProbe,
      telemetry
    };
    store = deps.store;
    const alerts = createAlertService({
      store: deps.store,
      botToken: config.zaloBotToken,
      recipients: resolveZaloRecipients(
        deps.store,
        config.zaloRecipientKey,
        config.zaloChatHashSecret,
        config.recipientIds
      ),
      recipientProvider: () =>
        resolveZaloRecipients(
          deps.store,
          config.zaloRecipientKey,
          config.zaloChatHashSecret,
          config.recipientIds
        ),
      recipientKey: config.zaloRecipientKey,
      timeoutMs: config.zaloTimeoutMs
    });
    const watchdog = startSystemdWatchdog();
    const cycle = async () => {
      const at = new Date();
      const transitions = await runCollectorCycle(deps, at);
      for (const transition of transitions) await alerts.queueTransitionDelivery(transition);
      await alerts.deliverDueAlerts(at);
      // Process one small retention batch per cycle; the 15-second interval yields between batches.
      deps.store.pruneRetentionBatch(at.toISOString());
    };
    loop = await startCollectorLoop({
      cycle,
      watchdog,
      schedule: (callback) => {
        const timer = setInterval(callback, 15_000);
        return () => clearInterval(timer);
      },
      onFailure: (error) => {
        captureOpsException(error, {
          code: 'COLLECTOR_CYCLE_FAILED',
          source: 'job',
          level: 'fatal'
        });
        console.error(
          'ops-collector cycle failed',
          error instanceof Error ? error.message : 'unknown_error'
        );
        process.exitCode = 1;
        void stopRuntimeTelemetry().catch((error) => {
          captureOpsException(error, {
            code: 'UNHANDLED_PROMISE_REJECTION',
            source: 'job',
            status: 500
          });
          return undefined;
        });
      }
    });
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    return { close: stopRuntimeTelemetry };
  } catch (error) {
    captureOpsException(error, {
      code: 'COLLECTOR_STARTUP_FAILED',
      source: 'process',
      level: 'fatal'
    });
    await stopRuntimeTelemetry(true, error);
    throw error;
  }
}
