import { readFile } from 'node:fs/promises';

import {
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot
} from '../../../../packages/telemetry-sdk/src/oneShot.js';
import type { RuntimeTelemetry } from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
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

export function runBeszelSmokeEntrypoint(
  input: {
    environment?: NodeJS.ProcessEnv;
    telemetry?: RuntimeTelemetry;
    run?: () => Promise<BeszelSmokeResult>;
    onFailure?: (error: unknown) => void | Promise<void>;
    rethrow?: boolean;
  } = {}
): Promise<BeszelSmokeResult | undefined> {
  const environment = input.environment ?? process.env;
  const common = {
    createTelemetry: () =>
      input.telemetry ??
      createOpsProcessRuntimeTelemetryFromEnvironment({
        environment,
        resolveHmacSecret: async () => {
          const hmacFile = environment.OPS_TELEMETRY_HMAC_FILE?.trim();
          if (!hmacFile) throw new Error('OPS_TELEMETRY_HMAC_FILE is required');
          return readFile(hmacFile, 'utf8');
        },
        service: 'edutrack-ops-beszel-smoke',
        spoolName: 'beszel-smoke'
      }),
    failureContext: {
      code: 'BESZEL_SMOKE_FAILED',
      source: 'provider' as const,
      level: 'fatal' as const
    },
    run: input.run ?? (() => smokeBeszelContract(loadCollectorConfig(environment))),
    ...(input.onFailure ? { onFailure: input.onFailure } : {})
  };
  return input.rethrow === false
    ? runConfiguredOpsTelemetryOneShot({ ...common, rethrow: false })
    : runConfiguredOpsTelemetryOneShot({ ...common, rethrow: true });
}

if (process.argv[1]?.endsWith('/smoke-beszel.js')) {
  void runBeszelSmokeEntrypoint({
    rethrow: false,
    run: async () => {
      const result = await smokeBeszelContract(loadCollectorConfig(process.env));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result;
    },
    onFailure: (error: unknown) => {
      const code =
        error instanceof BeszelClientError || error instanceof Error
          ? error.message
          : 'beszel_smoke_failed';
      process.stderr.write(`${/^[a-z0-9_]+$/u.test(code) ? code : 'beszel_smoke_failed'}\n`);
      process.exitCode = 1;
    }
  });
}
