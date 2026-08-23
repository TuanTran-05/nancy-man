import { loadCollectorConfig } from '../config.js';
import { createOpsStore } from '../storage/store.js';
import { runCollectorCycle, type CollectorDeps } from './collector.js';

export async function startCollector(): Promise<void> {
  const config = loadCollectorConfig(process.env);
  const dbPath = process.env.OPS_DB_PATH;
  if (!dbPath) throw new Error('OPS_DB_PATH is required for collector');
  const deps: CollectorDeps = { config, store: createOpsStore(dbPath), histories: new Map() };
  const cycle = async () => { await runCollectorCycle(deps, new Date()); };
  await cycle();
  const timer = setInterval(() => { cycle().catch(() => undefined); }, 15_000);
  process.once('SIGTERM', () => clearInterval(timer));
  process.once('SIGINT', () => clearInterval(timer));
}

if (import.meta.url === `file://${process.argv[1]}`) startCollector().catch(() => { process.exitCode = 1; });
