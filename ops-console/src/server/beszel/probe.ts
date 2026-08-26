import type { MonitorSample } from '../../shared/models.js';
import { BeszelClientError, type BeszelProbeErrorCode, type BeszelRawSnapshot } from './client.js';
import { normalizeBeszelSnapshot } from './mapper.js';

export interface BeszelSnapshotReader {
  readSnapshot(): Promise<BeszelRawSnapshot>;
}

const failure = (now: Date, code: BeszelProbeErrorCode): MonitorSample => ({
  monitor: 'beszel',
  level: 'critical',
  observedAt: now.toISOString(),
  latencyMs: null,
  details: { probeOk: false },
  errorCode: code,
});

const success = (now: Date, normalized: ReturnType<typeof normalizeBeszelSnapshot>): MonitorSample[] => [
  {
    monitor: 'beszel',
    level: 'healthy',
    observedAt: now.toISOString(),
    latencyMs: null,
    details: {
      probeOk: true,
      hubVersion: normalized.hubVersion,
      agentVersion: normalized.agentVersion,
      systemStatus: normalized.systemStatus,
      metricObservedAt: normalized.metricObservedAt,
    },
    errorCode: null,
  },
  {
    monitor: 'host_resources',
    level: 'healthy',
    observedAt: normalized.metricObservedAt,
    latencyMs: null,
    details: normalized.resources,
    errorCode: null,
  },
  {
    monitor: 'host_services',
    level: 'healthy',
    observedAt: normalized.metricObservedAt,
    latencyMs: null,
    details: {
      matchedTotal: normalized.matchedTotal,
      failedServices: normalized.failedServices,
      services: normalized.services,
    },
    errorCode: null,
  },
];

export function createBeszelProbe(client: BeszelSnapshotReader) {
  return async function probe(now = new Date()): Promise<MonitorSample[]> {
    try {
      const normalized = normalizeBeszelSnapshot(await client.readSnapshot(), now);
      if (normalized.systemStatus !== 'up') return [failure(now, 'beszel_agent_down')];
      if (now.getTime() - Date.parse(normalized.metricObservedAt) > 180_000) return [failure(now, 'beszel_metric_stale')];
      return success(now, normalized);
    } catch (error) {
      return [failure(now, error instanceof BeszelClientError ? error.code : 'beszel_unreachable')];
    }
  };
}
