import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { describe, expect, it } from 'vitest';

import {
  BrowserSpool,
  createIndexedDbBrowserSpoolStore,
  type BrowserSpoolStore
} from './browserSpool.js';

function envelope(eventId: `EVT_${string}`, capturedAt: string): TelemetryEnvelopeV1 {
  return {
    schemaVersion: 1,
    eventId,
    idempotencyKey: `idem-${eventId}`,
    capturedAt,
    source: 'browser',
    level: 'error',
    error: { name: 'Error', code: 'BROWSER_EXCEPTION', safeMessage: 'safe failure' },
    context: { release: 'release', service: 'edutrack-web', environment: 'production' }
  };
}

function memoryStore(): BrowserSpoolStore & {
  records: Map<string, Parameters<BrowserSpoolStore['put']>[0]>;
} {
  const records = new Map<string, Parameters<BrowserSpoolStore['put']>[0]>();
  return {
    records,
    list: async () => [...records.values()],
    put: async (record) => {
      records.set(record.idempotencyKey, record);
    },
    remove: async (idempotencyKey) => {
      records.delete(idempotencyKey);
    }
  };
}

describe('BrowserSpool', () => {
  it('fails closed if an IndexedDB adapter is configured outside a browser runtime', () => {
    expect(() => createIndexedDbBrowserSpoolStore()).toThrowError(
      new Error('IndexedDB storage is unavailable')
    );
  });

  it('keeps only recent events within the 100-event capacity, evicting the oldest first', async () => {
    const store = memoryStore();
    const spool = new BrowserSpool({
      store,
      now: () => new Date('2026-08-22T08:00:00.000Z'),
      random: () => 0
    });

    for (let index = 0; index < 101; index += 1) {
      await spool.enqueue(
        envelope(
          `EVT_${String(index).padStart(26, '0')}`,
          new Date(Date.UTC(2026, 7, 22, 7, 0, index)).toISOString()
        )
      );
    }

    expect(store.records).toHaveLength(100);
    expect(store.records.has('idem-EVT_00000000000000000000000000')).toBe(false);
    expect(store.records.has('idem-EVT_00000000000000000000000064')).toBe(true);
  });

  it('removes only acknowledged events and schedules a failed delivery for retry', async () => {
    const store = memoryStore();
    const now = new Date('2026-08-22T08:00:00.000Z');
    const spool = new BrowserSpool({ store, now: () => now, random: () => 0 });
    const first = envelope('EVT_00000000000000000000000001', now.toISOString());
    const second = envelope('EVT_00000000000000000000000002', now.toISOString());
    await spool.enqueue(first);
    await spool.enqueue(second);

    await expect(
      spool.flush(async (queued) => {
        if (queued.eventId === first.eventId) {
          return { acknowledgedIdempotencyKey: queued.idempotencyKey };
        }
        throw new Error('collector unavailable');
      })
    ).resolves.toEqual({ delivered: 1, deferred: 1 });

    expect(store.records.has(first.idempotencyKey)).toBe(false);
    expect(store.records.get(second.idempotencyKey)).toMatchObject({ attemptCount: 1 });
  });

  it('sanitizes again before persisting an event for browser retry', async () => {
    const store = memoryStore();
    const spool = new BrowserSpool({ store });
    const unsafe = envelope('EVT_00000000000000000000000003', '2026-08-22T08:00:00.000Z');
    unsafe.error.safeMessage = 'Bearer abc.def.ghi password=never-spool';

    await spool.enqueue(unsafe);

    expect(JSON.stringify([...store.records.values()])).not.toMatch(
      /Bearer |password=never-spool/i
    );
  });
});
