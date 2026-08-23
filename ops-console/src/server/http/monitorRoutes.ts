import type { Router, Response } from 'express';
import { z } from 'zod';
import type { OpsStore } from '../storage/store.js';
import type { DashboardOverview, MonitorSample } from '../../shared/models.js';
import { requireOpsSession, type AuthService, type SessionRequest } from './authRoutes.js';

const noteSchema = z.object({ note: z.string().min(1).max(500) }).strict();
const publicDetailKeys = new Set(['probeOk', 'status', 'release', 'postgres', 'pid', 'state', 'memoryBytes', 'processName', 'startedAt', 'waitingLockCount', 'connectionStates', 'settings', 'databaseSizeBytes', 'activeCount', 'deadlocks', 'rollbacks', 'tempFiles', 'tempBytes', 'userTables', 'jobs', 'latestBackupAt', 'ageHours', 'encrypted', 'checksumPresent', 'localOnly', 'diskUsagePercent', 'fingerprint', 'fingerprintCount5m', 'isFatal', 'safeExcerpt']);

function safeValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(safeValue);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [key, safeValue(item)]));
  return null;
}

function publicSample(sample: MonitorSample): MonitorSample {
  const details = Object.fromEntries(Object.entries(sample.details).filter(([key]) => publicDetailKeys.has(key)).map(([key, value]) => [key, safeValue(value)]));
  return { ...sample, details };
}

function publicOverview(overview: DashboardOverview): DashboardOverview {
  return { ...overview, latestByMonitor: Object.fromEntries(Object.entries(overview.latestByMonitor).map(([key, value]) => [key, value ? publicSample(value) : value])) };
}

function respondNoStore(response: Response): void { response.setHeader('Cache-Control', 'no-store'); }

export function attachMonitorRoutes(router: Router, store: OpsStore, auth: AuthService): void {
  const guard = requireOpsSession(auth);
  router.get('/api/overview', guard, (_request, response) => { respondNoStore(response); response.json(publicOverview(store.readDashboardOverview())); });
  router.get('/api/incidents', guard, (_request, response) => { respondNoStore(response); response.json(store.readDashboardOverview().openIncidents); });
  router.post('/api/incidents/:id/ack', guard, (request: SessionRequest, response) => {
    respondNoStore(response);
    const parsed = noteSchema.safeParse(request.body);
    const csrf = request.header('X-CSRF-Token');
    if (!csrf || !auth.verifySessionCsrf(request.opsSession!, csrf)) { response.status(403).json({ error: 'csrf_required' }); return; }
    if (!parsed.success || !/^[^<>]*$/u.test(parsed.data.note)) { response.status(400).json({ error: 'invalid_note' }); return; }
    try {
      const incident = store.acknowledgeIncident(String(request.params.id), { accountId: request.opsSession!.accountId, note: parsed.data.note, now: new Date().toISOString() });
      response.json(incident);
    } catch { response.status(404).json({ error: 'incident_not_found' }); }
  });
}
