import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createOpsStore } from '../storage/store.js';
import { createAlertService } from './alertService.js';
import type { CollectorTransition } from '../collector/collector.js';

const transition = (overrides: Partial<CollectorTransition> = {}): CollectorTransition => ({
  monitor: 'app_liveness',
  sample: {
    monitor: 'app_liveness',
    level: 'critical',
    observedAt: '2026-08-23T00:00:00Z',
    latencyMs: null,
    details: {},
    errorCode: 'app_down'
  },
  level: 'critical',
  transition: 'opened',
  dedupeKey: 'app_liveness:app_down',
  safeSummary: 'Bearer [redacted]',
  occurrenceCount: 1,
  ...overrides
});

describe('alert outbox', () => {
  it('sends on transition, suppresses the same fingerprint for 30 minutes, then sends recovery once', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-alert-'));
    const store = createOpsStore(
      join(directory, 'ops.sqlite'),
      () => new Date('2026-08-23T00:00:00Z')
    );
    const sender = vi.fn(async () => ({ messageId: '1' }));
    const service = createAlertService({
      store,
      botToken: 'secret',
      recipientIds: ['ops-a'],
      timeoutMs: 5000,
      now: () => new Date('2026-08-23T00:00:00Z'),
      sender
    });
    try {
      await service.queueTransitionDelivery(transition());
      await service.queueTransitionDelivery(transition({ occurrenceCount: 2 }));
      expect(store.readDashboardOverview().recentDeliveries).toHaveLength(1);
      const recovered = transition({
        transition: 'recovered',
        sample: { ...transition().sample, level: 'healthy', errorCode: null },
        occurrenceCount: 3
      });
      await service.queueTransitionDelivery(recovered);
      expect(store.readDashboardOverview().recentDeliveries).toHaveLength(2);
      await service.deliverDueAlerts(new Date('2026-08-23T00:00:01Z'));
      expect(sender).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('never places a redacted excerpt in a Zalo message', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-alert-'));
    const store = createOpsStore(
      join(directory, 'ops.sqlite'),
      () => new Date('2026-08-23T00:00:00Z')
    );
    const sender = vi.fn(async (_config, text: string) => {
      expect(text).not.toContain('Bearer');
      return { messageId: '1' };
    });
    const service = createAlertService({
      store,
      botToken: 'secret',
      recipientIds: ['ops-a'],
      timeoutMs: 5000,
      now: () => new Date('2026-08-23T00:00:00Z'),
      sender
    });
    try {
      await service.queueTransitionDelivery(transition());
      await service.deliverDueAlerts();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retries bounded provider failures and records ambiguous delivery', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-alert-'));
    const store = createOpsStore(join(directory, 'ops.sqlite'));
    const sender = vi.fn(async () => {
      throw new Error('network timeout');
    });
    const service = createAlertService({
      store,
      botToken: 'secret',
      recipientIds: ['ops-a'],
      timeoutMs: 5000,
      now: () => new Date('2026-08-23T00:00:00Z'),
      sender
    });
    try {
      await service.queueTransitionDelivery(transition());
      await service.deliverDueAlerts(new Date('2026-08-23T00:00:00Z'));
      expect(store.readDashboardOverview().recentDeliveries[0]).toMatchObject({
        state: 'delivery_ambiguous',
        attemptCount: 1,
        lastErrorCode: 'delivery_failed'
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
