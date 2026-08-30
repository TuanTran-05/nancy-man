import { loadCollectorConfig } from '../config.js';
import { createOpsStore } from '../storage/store.js';
import { runCollectorCycle, type CollectorDeps } from './collector.js';
import { createAlertService } from '../alerts/alertService.js';
import { resolveZaloRecipients } from '../alerts/recipientResolver.js';
import { startSystemdWatchdog } from '../systemdNotify.js';
import { createBeszelClient } from '../beszel/client.js';
import { createBeszelProbe } from '../beszel/probe.js';

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
      stop();
      input.onFailure(error);
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
  const beszelProbe = config.beszel.enabled
    ? createBeszelProbe(createBeszelClient(config.beszel))
    : undefined;
  const deps: CollectorDeps = {
    config,
    store: createOpsStore(config.dbPath, undefined, config.zaloRecipientKey),
    histories: new Map(),
    beszelProbe
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
      console.error(
        'ops-collector cycle failed',
        error instanceof Error ? error.message : 'unknown_error'
      );
      process.exitCode = 1;
    }
  });
  process.once('SIGTERM', loop.stop);
  process.once('SIGINT', loop.stop);
}

if (import.meta.url === `file://${process.argv[1]}`)
  startCollector().catch(() => {
    process.exitCode = 1;
  });
