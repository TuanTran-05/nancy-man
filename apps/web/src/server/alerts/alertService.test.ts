import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createOpsStore } from '../storage/store.js';
import { createAlertService, formatAlertText } from './alertService.js';
import type { CollectorTransition } from '../collector/collector.js';
import { encryptSecret } from '../security/crypto.js';

const recipientKey = Buffer.alloc(32, 12);
const recipient = (recipientId: string) => ({
  recipientHash: `hash-${recipientId}`,
  recipientCiphertext: encryptSecret(recipientId, recipientKey)
});

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
      recipients: [recipient('ops-a')],
      recipientKey,
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
      recipients: [recipient('ops-a')],
      recipientKey,
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
      recipients: [recipient('ops-a')],
      recipientKey,
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

  describe('formatAlertText and parseAlertDetails', () => {
    it('formats a detailed warning message for an API error', () => {
      const text = formatAlertText({
        level: 'critical',
        monitor: 'errors',
        occurrenceCount: 1,
        observedAt: '2026-09-18T14:00:01Z',
        recovered: false,
        dedupeKey: 'errors:error_api_503',
        safeSummary:
          '[API_ERROR] POST /api/audit/esp-identity-health 503 internal_error: Internal server error (eventId: EVT_123)'
      });

      expect(text).toContain('CRITICAL: Ops Console');
      expect(text).toContain('Monitor: errors');
      expect(text).toContain('Trạng thái: critical');
      expect(text).toContain('Lỗi: Internal server error');
      expect(text).toContain('Mã lỗi: 503 internal_error');
      expect(text).toContain('Route: POST /api/audit/esp-identity-health');
      expect(text).toContain('Số lần: 1');
      expect(text).toContain('https://man.thienuy.edu.vn');
    });

    it('formats a detailed recovered message with start, end times and duration', () => {
      const text = formatAlertText({
        level: 'warning',
        monitor: 'errors',
        occurrenceCount: 1,
        observedAt: '2026-09-18T15:22:30.506Z',
        recovered: true,
        openedAt: '2026-09-18T15:22:00.497Z',
        recoveredAt: '2026-09-18T15:22:30.506Z',
        dedupeKey: 'errors:error_73648f2886b0',
        safeSummary: '(Use `node --trace-deprecation ...` to show where the warning was created)'
      });

      expect(text).toContain('RECOVERED: Ops Console');
      expect(text).toContain('Monitor: errors');
      expect(text).toContain('Trạng thái: recovered');
      expect(text).toContain('Sự cố đã khắc phục: Cảnh báo Deprecation trong Node.js / pg driver');
      expect(text).toContain('Mã lỗi: error_73648f2886b0');
      expect(text).toContain('Thời gian bắt đầu:');
      expect(text).toContain('Thời điểm phục hồi:');
      expect(text).toContain('Thời gian gián đoạn: 30s');
      expect(text).toContain('https://man.thienuy.edu.vn');
    });

    it('formats postgres and infrastructure monitor alerts with dedicated targets', () => {
      const text = formatAlertText({
        level: 'critical',
        monitor: 'postgres',
        occurrenceCount: 3,
        observedAt: '2026-09-18T15:00:00Z',
        recovered: false,
        dedupeKey: 'postgres:postgres_unreachable',
        safeSummary: 'postgres critical'
      });

      expect(text).toContain('CRITICAL: Ops Console');
      expect(text).toContain('Monitor: postgres');
      expect(text).toContain('Lỗi: Không thể kết nối cơ sở dữ liệu PostgreSQL');
      expect(text).toContain('Mã lỗi: postgres_unreachable');
      expect(text).toContain('Cơ sở dữ liệu PostgreSQL (127.0.0.1:5432)');
    });
  });
});
