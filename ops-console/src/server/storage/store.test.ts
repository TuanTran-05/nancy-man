import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { createOpsStore } from './store.js';

const tempDirs: string[] = [];
const makeStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-store-'));
  tempDirs.push(dir);
  return createOpsStore(join(dir, 'ops.sqlite'), () => new Date('2026-08-23T00:00:00.000Z'));
};

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('Ops SQLite store', () => {
  it('retains only sanitized samples inside the 30-day window', () => {
    const store = makeStore();
    store.recordSample({ monitor: 'postgres', level: 'healthy', observedAt: '2026-07-23T00:00:00Z', latencyMs: 4, details: {}, errorCode: null });
    store.pruneRetention();
    expect(store.readDashboardOverview().latestByMonitor.postgres).toBeUndefined();
  });

  it('acknowledges an incident without modifying its source sample', () => {
    const store = makeStore();
    store.recordSample({ monitor: 'postgres', level: 'critical', observedAt: '2026-08-23T00:00:00Z', latencyMs: null, details: { safe: true }, errorCode: 'database_unreachable' });
    const incident = store.upsertIncident({ dedupeKey: 'postgres:database_unreachable', monitor: 'postgres', level: 'critical', state: 'open', recoveredAt: null, acknowledgedAt: null, acknowledgedBy: null, note: null, safeSummary: 'Database unavailable', now: '2026-08-23T00:00:00Z' });
    store.acknowledgeIncident(incident.id, { accountId: 'ops-a', note: 'Đã xem', now: '2026-08-23T00:01:00Z' });
    expect(store.getIncident(incident.id)).toMatchObject({ state: 'acknowledged', acknowledgedBy: 'ops-a' });
    expect(store.readDashboardOverview().latestByMonitor.postgres?.errorCode).toBe('database_unreachable');
  });

  it('claims due deliveries exactly once and records bounded retry state', () => {
    const store = makeStore();
    const incident = store.upsertIncident({ dedupeKey: 'app:down', monitor: 'app_liveness', level: 'critical', state: 'open', recoveredAt: null, acknowledgedAt: null, acknowledgedBy: null, note: null, safeSummary: 'App unavailable', now: '2026-08-23T00:00:00Z' });
    const delivery = store.enqueueDelivery({ incidentId: incident.id, recipientId: 'ops-a', kind: 'opened', nextAttemptAt: '2026-08-23T00:00:00Z', lastErrorCode: null });
    const claimed = store.claimDueDeliveries('2026-08-23T00:00:01Z', 10);
    expect(claimed).toHaveLength(1);
    expect(store.claimDueDeliveries('2026-08-23T00:00:02Z', 10)).toHaveLength(0);
    store.failDelivery(delivery.id, { state: 'failed', errorCode: 'timeout', nextAttemptAt: '2026-08-23T00:01:00Z' });
    expect(store.claimDueDeliveries('2026-08-23T00:01:00Z', 10)[0]).toMatchObject({ attemptCount: 2, state: 'sending' });
  });

  it('persists cursors and writes audit events with bounded notes', () => {
    const store = makeStore();
    store.setCursor('/var/log/cron.log', { inode: 4, offset: 10 });
    expect(store.getCursor('/var/log/cron.log')).toEqual({ inode: 4, offset: 10 });
    store.recordAuditEvent({ actorId: null, action: 'login_failed', target: 'ops-a', details: { reason: 'invalid' }, occurredAt: '2026-08-23T00:00:00Z' });
    expect(store.listAuditEvents()).toContainEqual(expect.objectContaining({ action: 'login_failed' }));
  });
});
