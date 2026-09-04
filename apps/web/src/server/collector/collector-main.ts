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
import { createCollectorRuntimeTelemetry } from '../telemetry/runtimeTelemetry.js';

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
      try {
        input.onFailure(error);
      } catch {
        // A reporter failure must not leave the collector interval running.
      } finally {
        stop();
      }
    } finally {
      running = false;
    }
  };

  await input.cycle();
  input.watchdog.progress();
  cancelScheduledCycle = input.schedule(() => {
    void runScheduledCycle();
  });
  return { stop };
}

export async function startCollector(): Promise<void> {
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
  installNodeTelemetryLifecycle({
    captureException: telemetry.captureException,
    flush: telemetry.flush,
    exit: (code) => process.exit(code)
  });
  const beszelProbe = config.beszel.enabled
    ? createBeszelProbe(createBeszelClient(config.beszel))
    : undefined;
  const deps: CollectorDeps = {
    config,
    store: createOpsStore(config.dbPath, undefined, config.zaloRecipientKey),
    histories: new Map(),
    beszelProbe,
    telemetry
  };
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
  };
  const loop = await startCollectorLoop({
    cycle,
    watchdog,
    schedule: (callback) => {
      const timer = setInterval(callback, 15_000);
      return () => clearInterval(timer);
    },
    onFailure: (error) => {
      telemetry.captureException(error, {
        code: 'COLLECTOR_CYCLE_FAILED',
        source: 'job',
        level: 'fatal'
      });
      void telemetry.flush().catch(() => undefined);
      console.error(
        'ops-collector cycle failed',
        error instanceof Error ? error.message : 'unknown_error'
      );
      process.exitCode = 1;
    }
  });
  const shutdown = () => {
    loop.stop();
    stopTelemetryMaintenance();
    void telemetry.flush().catch(() => undefined);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) void startCollector();
