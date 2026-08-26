import type { InfrastructureServiceState, InfrastructureServiceSubState } from '../../shared/models.js';
import { BeszelClientError, type BeszelRawSnapshot } from './client.js';

const GIB = 1024 ** 3;
const SERVICE_MAX_AGE_MS = 15 * 60 * 1000;
const stateMap: readonly InfrastructureServiceState[] = ['active', 'inactive', 'failed', 'activating', 'deactivating', 'reloading'];
const subStateMap: readonly InfrastructureServiceSubState[] = ['dead', 'running', 'exited', 'failed', 'unknown'];
const allowedService = /^(?:nginx.*|postgresql.*|edutrack-ops-.*|pm2-.*)$/u;

export interface NormalizedBeszelSnapshot {
  hubVersion: '0.18.8';
  systemStatus: 'up' | 'down' | 'paused' | 'pending';
  agentVersion: string;
  metricObservedAt: string;
  matchedTotal: number;
  failedServices: string[];
  resources: Record<string, number | string | boolean | null>;
  services: Array<{
    name: string;
    state: InfrastructureServiceState;
    subState: InfrastructureServiceSubState;
    cpuPercent: number;
    memoryBytes: number;
    observedAt: string;
  }>;
}

const optionalTuple = (value: readonly unknown[] | undefined, index: number): number | null => {
  const metric = value?.[index];
  return typeof metric === 'number' && Number.isFinite(metric) ? metric : null;
};
const bytes = (gib: number): number => Math.round(gib * GIB);

function parseMetricTimestamp(value: string, now: Date): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp - now.getTime() > 5000) throw new BeszelClientError('beszel_contract_invalid');
  return new Date(timestamp).toISOString();
}

export function normalizeBeszelSnapshot(raw: BeszelRawSnapshot, now = new Date()): NormalizedBeszelSnapshot {
  const metricObservedAt = parseMetricTimestamp(raw.stats.created, now);
  const rawServices = raw.services.items;
  const expectedServiceTotal = raw.system.info.sv?.[0] ?? rawServices.length;
  if (expectedServiceTotal !== rawServices.length || raw.services.totalItems > rawServices.length) throw new BeszelClientError('beszel_contract_invalid');

  const freshServices = rawServices.flatMap((item) => {
    const updatedAt = item.updated;
    const age = now.getTime() - updatedAt;
    if (age < -5000) throw new BeszelClientError('beszel_contract_invalid');
    if (age > SERVICE_MAX_AGE_MS || !allowedService.test(item.name)) return [];
    const state = stateMap[item.state];
    const subState = subStateMap[item.sub];
    if (!state || !subState) throw new BeszelClientError('beszel_contract_invalid');
    return [{
      name: item.name,
      state,
      subState,
      cpuPercent: item.cpu,
      memoryBytes: item.memory,
      observedAt: new Date(updatedAt).toISOString(),
    }];
  });
  const failedServices = freshServices.filter((item) => item.state === 'failed' || item.subState === 'failed').map((item) => item.name).sort((a, b) => a.localeCompare(b, 'vi'));
  const services = [...freshServices].sort((a, b) => {
    const aFailed = a.state === 'failed' || a.subState === 'failed';
    const bFailed = b.state === 'failed' || b.subState === 'failed';
    if (aFailed !== bFailed) return aFailed ? -1 : 1;
    return a.name.localeCompare(b.name, 'vi');
  }).slice(0, 32);

  const stats = raw.stats.stats;
  const resources: NormalizedBeszelSnapshot['resources'] = {
    cpuPercent: stats.cpu,
    cpuUserPercent: optionalTuple(stats.cpub, 0),
    cpuSystemPercent: optionalTuple(stats.cpub, 1),
    cpuIoWaitPercent: optionalTuple(stats.cpub, 2),
    memoryPercent: stats.mp,
    memoryUsedBytes: bytes(stats.mu),
    memoryTotalBytes: bytes(stats.m),
    swapPercent: stats.s > 0 ? (stats.su / stats.s) * 100 : null,
    swapUsedBytes: bytes(stats.su),
    swapTotalBytes: bytes(stats.s),
    load1: optionalTuple(stats.la, 0),
    load5: optionalTuple(stats.la, 1),
    load15: optionalTuple(stats.la, 2),
    cpuThreads: raw.system.info.t ?? null,
    uptimeSeconds: raw.system.info.u,
    diskPercent: stats.dp,
    diskUsedBytes: bytes(stats.du),
    diskTotalBytes: bytes(stats.d),
    diskReadBytesPerSecond: optionalTuple(stats.dio, 0),
    diskWriteBytesPerSecond: optionalTuple(stats.dio, 1),
    diskIoUtilizationPercent: optionalTuple(stats.dios, 2),
    networkReceiveBytesPerSecond: optionalTuple(stats.b, 1),
    networkTransmitBytesPerSecond: optionalTuple(stats.b, 0),
    agentVersion: raw.system.info.v,
    metricObservedAt,
    probeOk: true,
  };

  return {
    hubVersion: raw.hub.v,
    systemStatus: raw.system.status,
    agentVersion: raw.system.info.v,
    metricObservedAt,
    matchedTotal: freshServices.length,
    failedServices,
    resources,
    services,
  };
}
