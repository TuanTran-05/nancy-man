import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { sanitizeTelemetry } from '../../security/src/telemetry/sanitizer.js';

const maximumEvents = 100;
const maximumBytes = 5 * 1024 * 1024;
const maximumAgeMilliseconds = 24 * 60 * 60 * 1_000;

export type BrowserSpoolRecord = {
  idempotencyKey: string;
  eventId: `EVT_${string}`;
  envelope: TelemetryEnvelopeV1;
  byteSize: number;
  enqueuedAt: string;
  attemptCount: number;
  nextAttemptAt?: string;
};

export type BrowserSpoolStore = {
  list: () => Promise<BrowserSpoolRecord[]>;
  put: (record: BrowserSpoolRecord) => Promise<void>;
  remove: (idempotencyKey: string) => Promise<void>;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), {
      once: true
    });
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
      { once: true }
    );
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB error')), {
      once: true
    });
  });
}

export function createIndexedDbBrowserSpoolStore(input: {
  databaseName?: string;
  objectStoreName?: string;
} = {}): BrowserSpoolStore {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB storage is unavailable');
  }

  const databaseName = input.databaseName ?? 'thienuy-ops-telemetry';
  const objectStoreName = input.objectStoreName ?? 'browser-spool-v1';
  let databasePromise: Promise<IDBDatabase> | undefined;

  const getDatabase = (): Promise<IDBDatabase> => {
    databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.addEventListener(
        'upgradeneeded',
        () => {
          if (!request.result.objectStoreNames.contains(objectStoreName)) {
            request.result.createObjectStore(objectStoreName, { keyPath: 'idempotencyKey' });
          }
        },
        { once: true }
      );
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')), {
        once: true
      });
    });
    return databasePromise;
  };

  return {
    list: async () => {
      const database = await getDatabase();
      const transaction = database.transaction(objectStoreName, 'readonly');
      const records = await requestResult<BrowserSpoolRecord[]>(
        transaction.objectStore(objectStoreName).getAll() as IDBRequest<BrowserSpoolRecord[]>
      );
      await transactionResult(transaction);
      return records;
    },
    put: async (record) => {
      const database = await getDatabase();
      const transaction = database.transaction(objectStoreName, 'readwrite');
      transaction.objectStore(objectStoreName).put(record);
      await transactionResult(transaction);
    },
    remove: async (idempotencyKey) => {
      const database = await getDatabase();
      const transaction = database.transaction(objectStoreName, 'readwrite');
      transaction.objectStore(objectStoreName).delete(idempotencyKey);
      await transactionResult(transaction);
    }
  };
}

function chronological(records: BrowserSpoolRecord[]): BrowserSpoolRecord[] {
  return [...records].sort(
    (left, right) =>
      Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt) ||
      left.idempotencyKey.localeCompare(right.idempotencyKey)
  );
}

function byteSize(envelope: TelemetryEnvelopeV1): number {
  return new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
}

export class BrowserSpool {
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly maxAgeMilliseconds: number;

  constructor(
    private readonly input: {
      store: BrowserSpoolStore;
      now?: () => Date;
      random?: () => number;
      maxEvents?: number;
      maxBytes?: number;
      maxAgeMilliseconds?: number;
    }
  ) {
    this.now = input.now ?? (() => new Date());
    this.random = input.random ?? Math.random;
    this.maxEvents = input.maxEvents ?? maximumEvents;
    this.maxBytes = input.maxBytes ?? maximumBytes;
    this.maxAgeMilliseconds = input.maxAgeMilliseconds ?? maximumAgeMilliseconds;
  }

  async enqueue(envelope: TelemetryEnvelopeV1): Promise<{ queued: boolean; evicted: number }> {
    const sanitizedEnvelope = sanitizeTelemetry(envelope, {
      sessionPepper: 'browser-telemetry-session-id-not-provided'
    }).envelope;
    const size = byteSize(sanitizedEnvelope);
    if (size > this.maxBytes) {
      return { queued: false, evicted: 0 };
    }

    const currentTime = this.now();
    const record: BrowserSpoolRecord = {
      idempotencyKey: sanitizedEnvelope.idempotencyKey,
      eventId: sanitizedEnvelope.eventId,
      envelope: sanitizedEnvelope,
      byteSize: size,
      enqueuedAt: currentTime.toISOString(),
      attemptCount: 0
    };
    const cutoff = currentTime.getTime() - this.maxAgeMilliseconds;
    const existing = chronological(await this.input.store.list()).filter(
      (queued) => queued.idempotencyKey !== record.idempotencyKey
    );
    let retainedBytes = 0;
    let evicted = 0;
    const retained: BrowserSpoolRecord[] = [];

    for (const queued of existing) {
      if (!Number.isFinite(Date.parse(queued.enqueuedAt)) || Date.parse(queued.enqueuedAt) < cutoff) {
        await this.input.store.remove(queued.idempotencyKey);
        evicted += 1;
        continue;
      }
      retained.push(queued);
      retainedBytes += queued.byteSize;
    }

    while (
      retained.length >= this.maxEvents ||
      (retained.length > 0 && retainedBytes + record.byteSize > this.maxBytes)
    ) {
      const oldest = retained.shift();
      if (!oldest) break;
      retainedBytes -= oldest.byteSize;
      await this.input.store.remove(oldest.idempotencyKey);
      evicted += 1;
    }

    await this.input.store.put(record);
    return { queued: true, evicted };
  }

  async flush(
    deliver: (
      envelope: TelemetryEnvelopeV1
    ) => Promise<{ acknowledgedIdempotencyKey: string }>
  ): Promise<{ delivered: number; deferred: number }> {
    const currentTime = this.now();
    const cutoff = currentTime.getTime() - this.maxAgeMilliseconds;
    let delivered = 0;
    let deferred = 0;

    for (const queued of chronological(await this.input.store.list())) {
      const enqueuedAt = Date.parse(queued.enqueuedAt);
      if (!Number.isFinite(enqueuedAt) || enqueuedAt < cutoff) {
        await this.input.store.remove(queued.idempotencyKey);
        continue;
      }
      const nextAttemptAt = queued.nextAttemptAt ? Date.parse(queued.nextAttemptAt) : null;
      if (nextAttemptAt && nextAttemptAt > currentTime.getTime()) {
        deferred += 1;
        continue;
      }

      try {
        const acknowledgment = await deliver(queued.envelope);
        if (acknowledgment.acknowledgedIdempotencyKey !== queued.idempotencyKey) {
          throw new Error('Collector acknowledgement did not match the queued idempotency key');
        }
        await this.input.store.remove(queued.idempotencyKey);
        delivered += 1;
      } catch {
        const attemptCount = queued.attemptCount + 1;
        const baseDelay = Math.min(15 * 60 * 1_000, 1_000 * 2 ** Math.min(attemptCount, 10));
        const jitteredDelay = Math.round(baseDelay * (0.5 + this.random()));
        await this.input.store.put({
          ...queued,
          attemptCount,
          nextAttemptAt: new Date(currentTime.getTime() + jitteredDelay).toISOString()
        });
        deferred += 1;
      }
    }

    return { delivered, deferred };
  }
}
