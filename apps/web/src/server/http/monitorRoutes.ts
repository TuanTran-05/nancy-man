import type { Router, Response } from 'express';
import { z } from 'zod';
import type { OpsStore } from '../storage/store.js';
import type {
  DashboardOverview,
  InfrastructureHistoryRange,
  MonitorSample
} from '../../shared/models.js';
import { requireOpsSession, type AuthService, type SessionRequest } from './authRoutes.js';

const noteSchema = z.object({ note: z.string().min(1).max(500) }).strict();
const publicDetailKeys = new Set([
  'probeOk',
  'status',
  'release',
  'postgres',
  'pid',
  'state',
  'memoryBytes',
  'processName',
  'startedAt',
  'uptimeSeconds',
  'waitingLockCount',
  'connectionStates',
  'settings',
  'databaseSizeBytes',
  'activeCount',
  'deadlocks',
  'rollbacks',
  'tempFiles',
  'tempBytes',
  'userTables',
  'jobs',
  'latestBackupAt',
  'ageHours',
  'encrypted',
  'checksumPresent',
  'localOnly',
  'diskUsagePercent',
  'fingerprint',
  'fingerprintCount5m',
  'isFatal',
  'safeExcerpt'
]);
const resourceKeys = [
  'cpuPercent',
  'cpuUserPercent',
  'cpuSystemPercent',
  'cpuIoWaitPercent',
  'memoryPercent',
  'memoryUsedBytes',
  'memoryTotalBytes',
  'swapPercent',
  'swapUsedBytes',
  'swapTotalBytes',
  'load1',
  'load5',
  'load15',
  'cpuThreads',
  'uptimeSeconds',
  'diskPercent',
  'diskUsedBytes',
  'diskTotalBytes',
  'diskReadBytesPerSecond',
  'diskWriteBytesPerSecond',
  'diskIoUtilizationPercent',
  'networkReceiveBytesPerSecond',
  'networkTransmitBytesPerSecond',
  'agentVersion',
  'metricObservedAt',
  'probeOk'
] as const;

function safeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(safeValue);
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, safeValue(item)])
    );
  return null;
}

function publicSample(sample: MonitorSample): MonitorSample {
  const publicHostResources = (details: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      resourceKeys.map((key) => [
        key,
        key === 'agentVersion' || key === 'metricObservedAt'
          ? typeof details[key] === 'string'
            ? details[key]
            : null
          : key === 'probeOk'
            ? details[key] === true
            : typeof details[key] === 'number' && Number.isFinite(details[key])
              ? details[key]
              : null
      ])
    );
  const publicBeszel = (details: Record<string, unknown>): Record<string, unknown> => ({
    probeOk: details.probeOk === true,
    hubVersion: typeof details.hubVersion === 'string' ? details.hubVersion : null,
    agentVersion: typeof details.agentVersion === 'string' ? details.agentVersion : null,
    systemStatus: typeof details.systemStatus === 'string' ? details.systemStatus : null,
    metricObservedAt: typeof details.metricObservedAt === 'string' ? details.metricObservedAt : null
  });
  const publicHostServices = (details: Record<string, unknown>): Record<string, unknown> => ({
    matchedTotal:
      typeof details.matchedTotal === 'number' && Number.isFinite(details.matchedTotal)
        ? details.matchedTotal
        : null,
    failedServices: Array.isArray(details.failedServices)
      ? details.failedServices
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 32)
      : [],
    services: Array.isArray(details.services)
      ? details.services.slice(0, 32).flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const item = value as Record<string, unknown>;
          if (
            typeof item.name !== 'string' ||
            typeof item.state !== 'string' ||
            typeof item.subState !== 'string' ||
            typeof item.observedAt !== 'string'
          )
            return [];
          return [
            {
              name: item.name,
              state: item.state,
              subState: item.subState,
              cpuPercent:
                typeof item.cpuPercent === 'number' && Number.isFinite(item.cpuPercent)
                  ? item.cpuPercent
                  : null,
              memoryBytes:
                typeof item.memoryBytes === 'number' && Number.isFinite(item.memoryBytes)
                  ? item.memoryBytes
                  : null,
              observedAt: item.observedAt
            }
          ];
        })
      : []
  });
  const details =
    sample.monitor === 'host_resources'
      ? publicHostResources(sample.details)
      : sample.monitor === 'host_services'
        ? publicHostServices(sample.details)
        : sample.monitor === 'beszel'
          ? publicBeszel(sample.details)
          : Object.fromEntries(
              Object.entries(sample.details)
                .filter(([key]) => publicDetailKeys.has(key))
                .map(([key, value]) => [key, safeValue(value)])
            );
  return { ...sample, details };
}

export function publicOverview(overview: DashboardOverview): DashboardOverview {
  return {
    ...overview,
    latestByMonitor: Object.fromEntries(
      Object.entries(overview.latestByMonitor).map(([key, value]) => [
        key,
        value ? publicSample(value) : value
      ])
    )
  };
}

function respondNoStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

export function attachMonitorRoutes(router: Router, store: OpsStore, auth: AuthService): void {
  const guard = requireOpsSession(auth);
  router.get('/api/overview', guard, (_request, response) => {
    respondNoStore(response);
    response.json(publicOverview(store.readDashboardOverview()));
  });
  router.get('/api/infrastructure/history', guard, (request, response) => {
    respondNoStore(response);
    const range = z.enum(['1h', '24h', '7d', '30d']).safeParse(request.query.range);
    if (!range.success) {
      response.status(400).json({ error: 'invalid_range' });
      return;
    }
    const ranges: Record<
      InfrastructureHistoryRange,
      { milliseconds: number; resolutionSeconds: 60 | 300 | 1800 | 7200 }
    > = {
      '1h': { milliseconds: 60 * 60_000, resolutionSeconds: 60 },
      '24h': { milliseconds: 24 * 60 * 60_000, resolutionSeconds: 300 },
      '7d': { milliseconds: 7 * 24 * 60 * 60_000, resolutionSeconds: 1800 },
      '30d': { milliseconds: 30 * 24 * 60 * 60_000, resolutionSeconds: 7200 }
    };
    const selected = ranges[range.data];
    const to = new Date();
    const points = store.readInfrastructureHistory({
      from: new Date(to.getTime() - selected.milliseconds).toISOString(),
      to: to.toISOString(),
      resolutionSeconds: selected.resolutionSeconds,
      limit: 720
    });
    response.json({
      range: range.data,
      resolutionSeconds: selected.resolutionSeconds,
      collectedAt: to.toISOString(),
      points
    });
  });
  router.get('/api/incidents', guard, (_request, response) => {
    respondNoStore(response);
    response.json(store.readDashboardOverview().openIncidents);
  });
  router.post('/api/incidents/:id/ack', guard, (request: SessionRequest, response) => {
    respondNoStore(response);
    const parsed = noteSchema.safeParse(request.body);
    const csrf = request.header('X-CSRF-Token');
    if (!csrf || !auth.verifySessionCsrf(request.opsSession!, csrf)) {
      response.status(403).json({ error: 'csrf_required' });
      return;
    }
    if (!parsed.success || !/^[^<>]*$/u.test(parsed.data.note)) {
      response.status(400).json({ error: 'invalid_note' });
      return;
    }
    try {
      const incident = store.acknowledgeIncident(String(request.params.id), {
        accountId: request.opsSession!.accountId,
        note: parsed.data.note,
        now: new Date().toISOString()
      });
      response.json(incident);
    } catch {
      response.status(404).json({ error: 'incident_not_found' });
    }
  });
}
