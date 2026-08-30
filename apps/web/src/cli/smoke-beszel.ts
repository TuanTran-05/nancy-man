import { loadCollectorConfig, type CollectorConfig } from '../server/config.js';
import {
  BeszelClientError,
  createBeszelClient,
  type BeszelRawSnapshot
} from '../server/beszel/client.js';
import { normalizeBeszelSnapshot } from '../server/beszel/mapper.js';

export interface BeszelSnapshotReader {
  readSnapshot(): Promise<BeszelRawSnapshot>;
}

export interface BeszelSmokeResult {
  hubVersion: '0.18.8';
  systemStatus: 'up' | 'down' | 'paused' | 'pending';
  agentVersion: string;
  metricAgeSeconds: number;
  serviceCount: number;
}

export async function smokeBeszelContract(
  config: CollectorConfig,
  reader?: BeszelSnapshotReader,
  now = new Date()
): Promise<BeszelSmokeResult> {
  if (!config.beszel.enabled) throw new Error('beszel_smoke_requires_enabled_config');
  const source = reader ?? createBeszelClient(config.beszel);
  const normalized = normalizeBeszelSnapshot(await source.readSnapshot(), now);
  const metricAgeSeconds = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(normalized.metricObservedAt)) / 1000)
  );
  if (metricAgeSeconds > 180) throw new Error('beszel_metric_stale');
  return {
    hubVersion: normalized.hubVersion,
    systemStatus: normalized.systemStatus,
    agentVersion: normalized.agentVersion,
    metricAgeSeconds,
    serviceCount: normalized.matchedTotal
  };
}

if (process.argv[1]?.endsWith('/smoke-beszel.js')) {
  Promise.resolve()
    .then(() => smokeBeszelContract(loadCollectorConfig(process.env)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error: unknown) => {
      const code =
        error instanceof BeszelClientError || error instanceof Error
          ? error.message
          : 'beszel_smoke_failed';
      process.stderr.write(`${/^[a-z0-9_]+$/u.test(code) ? code : 'beszel_smoke_failed'}\n`);
      process.exitCode = 1;
    });
}
