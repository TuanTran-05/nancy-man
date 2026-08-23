import { loadCollectorConfig } from '../config.js';
import { createOpsStore } from '../storage/store.js';
import { runCollectorCycle, type CollectorDeps } from './collector.js';
import { createAlertService } from '../alerts/alertService.js';
import { resolveZaloRecipients } from '../alerts/recipientResolver.js';

export async function startCollector(): Promise<void> {
  const config = loadCollectorConfig(process.env);
  const deps: CollectorDeps = { config, store: createOpsStore(config.dbPath), histories: new Map() };
  const alerts = createAlertService({
    store: deps.store,
    botToken: config.zaloBotToken,
    recipientIds: config.recipientIds,
    recipientProvider: () => resolveZaloRecipients(deps.store, config.zaloRecipientKey, config.recipientIds),
    timeoutMs: config.zaloTimeoutMs,
  });
  const cycle = async () => {
    const at = new Date();
    const transitions = await runCollectorCycle(deps, at);
    for (const transition of transitions) await alerts.queueTransitionDelivery(transition);
    await alerts.deliverDueAlerts(at);
  };
  await cycle();
  const timer = setInterval(() => { cycle().catch(() => undefined); }, 15_000);
  process.once('SIGTERM', () => clearInterval(timer));
  process.once('SIGINT', () => clearInterval(timer));
}

if (import.meta.url === `file://${process.argv[1]}`) startCollector().catch(() => { process.exitCode = 1; });
