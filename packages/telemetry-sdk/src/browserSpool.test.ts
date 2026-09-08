import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { describe, expect, it, vi } from 'vitest';

import {
  BrowserSpool,
  createIndexedDbBrowserSpoolStore,
  createResilientBrowserSpoolStore,
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
  it('quarantines malformed persisted records without blocking a new enqueue or flush', async () => {
    const backing = memoryStore();
    const store: BrowserSpoolStore = {
      ...backing,
      list: async () => [{} as never, ...(await backing.list())]
    };
    let corruptRecords = 0;
    const spool = new BrowserSpool({
      store,
      onCorruptRecord: () => {
        corruptRecords += 1;
      }
    });
    const queued = envelope('EVT_00000000000000000000000008', '2026-08-22T08:00:00.000Z');

    await expect(spool.enqueue(queued)).resolves.toMatchObject({ queued: true });
    const delivered: string[] = [];
    await expect(
      spool.flush(async (record) => {
        delivered.push(record.eventId);
        return { acknowledgedIdempotencyKey: record.idempotencyKey };
      })
    ).resolves.toEqual({ delivered: 1, deferred: 0 });

    expect(corruptRecords).toBeGreaterThan(0);
    expect(delivered).toEqual([queued.eventId]);
    expect(backing.records.size).toBe(0);
  });

  it('preserves valid primary records when one malformed row activates fallback', async () => {
    const fallback = memoryStore();
    const validEnvelope = envelope('EVT_00000000000000000000000005', '2026-08-22T08:00:00.000Z');
    const validRecord = {
      idempotencyKey: validEnvelope.idempotencyKey,
      eventId: validEnvelope.eventId,
      envelope: validEnvelope,
      byteSize: new TextEncoder().encode(JSON.stringify(validEnvelope)).byteLength,
      enqueuedAt: validEnvelope.capturedAt,
      attemptCount: 0
    };
    const store = createResilientBrowserSpoolStore(
      {
        list: async () => [validRecord, {} as never],
        put: async () => undefined,
        remove: async () => undefined
      },
      fallback
    );
    const spool = new BrowserSpool({
      store,
      now: () => new Date('2026-08-22T08:00:01.000Z')
    });
    const delivered: string[] = [];

    await spool.flush(async (record) => {
      delivered.push(record.eventId);
      return { acknowledgedIdempotencyKey: record.idempotencyKey };
    });

    expect(delivered).toEqual([validEnvelope.eventId]);
    expect(fallback.records.size).toBe(0);
  });

  it('serializes concurrent enqueues at capacity and coalesces overlapping flushes', async () => {
    const store = memoryStore();
    const spool = new BrowserSpool({ store, maxEvents: 1 });
    const first = envelope('EVT_00000000000000000000000006', '2026-08-22T08:00:00.000Z');
    const second = envelope('EVT_00000000000000000000000007', '2026-08-22T08:00:01.000Z');
    await Promise.all([spool.enqueue(first), spool.enqueue(second)]);
    expect(store.records.size).toBe(1);
    expect(store.records.has(second.idempotencyKey)).toBe(true);

    let releaseDelivery: (() => void) | undefined;
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const deliver = vi.fn(async (record: TelemetryEnvelopeV1) => {
      await deliveryGate;
      return { acknowledgedIdempotencyKey: record.idempotencyKey };
    });
    const firstFlush = spool.flush(deliver);
    const secondFlush = spool.flush(deliver);
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    releaseDelivery?.();

    await expect(Promise.all([firstFlush, secondFlush])).resolves.toEqual([
      { delivered: 1, deferred: 0 },
      { delivered: 1, deferred: 0 }
    ]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(store.records.size).toBe(0);
  });

  it('switches permanently to memory after an asynchronous primary-store failure', async () => {
    const fallback = memoryStore();
    let degraded = 0;
    const store = createResilientBrowserSpoolStore(
      {
        list: async () => {
          throw new Error('IndexedDB open failed');
        },
        put: async () => {
          throw new Error('IndexedDB open failed');
        },
        remove: async () => {
          throw new Error('IndexedDB open failed');
        }
      },
      fallback,
      () => {
        degraded += 1;
      }
    );
    const queued = envelope('EVT_00000000000000000000000009', '2026-08-22T08:00:00.000Z');

    await expect(new BrowserSpool({ store }).enqueue(queued)).resolves.toMatchObject({
      queued: true
    });

    expect(fallback.records.has(queued.idempotencyKey)).toBe(true);
    expect(degraded).toBe(1);
  });

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

  it('retains one bounded eviction diagnostic until a successful delivery', async () => {
    const store = memoryStore();
    const spool = new BrowserSpool({ store, maxEvents: 1 });
    const first = envelope('EVT_00000000000000000000000010', '2026-08-22T08:00:00.000Z');
    const second = envelope('EVT_00000000000000000000000011', '2026-08-22T08:00:01.000Z');
    await spool.enqueue(first);
    const result = await spool.enqueue(second);

    await spool.recordEvictionDiagnostic(second, result.evicted);

    const diagnostic = [...store.records.values()].find(
      (record) => record.envelope.error.code === 'BROWSER_TELEMETRY_SPOOL_EVICTED'
    );
    expect(diagnostic?.envelope).toMatchObject({
      level: 'warning',
      error: { safeMessage: 'Browser telemetry spool evicted 1 event(s)' }
    });
    await expect(
      spool.flush(async (queued) => ({ acknowledgedIdempotencyKey: queued.idempotencyKey }))
    ).resolves.toEqual({ delivered: 2, deferred: 0 });
    expect(store.records).toHaveLength(0);
  });
});
