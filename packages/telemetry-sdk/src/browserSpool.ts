import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { sanitizeBrowserTelemetry } from '../../security/src/telemetry/sanitizer.browser.js';
import { createBrowserEventId } from './ids.browser.js';

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
  diagnosticCount?: number;
};

export type BrowserSpoolStore = {
  list: () => Promise<BrowserSpoolRecord[]>;
  put: (record: BrowserSpoolRecord) => Promise<void>;
  remove: (idempotencyKey: string) => Promise<void>;
};

type SwitchableBrowserSpoolStore = BrowserSpoolStore & {
  activateFallback?: () => void;
};

export function createResilientBrowserSpoolStore(
  primary: BrowserSpoolStore,
  fallback: BrowserSpoolStore,
  onFallback?: () => void
): SwitchableBrowserSpoolStore {
  let useFallback = false;
  const activateFallback = (): void => {
    if (useFallback) return;
    useFallback = true;
    try {
      onFallback?.();
    } catch {
      // A degradation observer cannot block the in-memory fallback.
    }
  };
  const run = async <T>(
    primaryOperation: () => Promise<T>,
    fallbackOperation: () => Promise<T>
  ): Promise<T> => {
    if (useFallback) return fallbackOperation();
    try {
      return await primaryOperation();
    } catch {
      activateFallback();
      return fallbackOperation();
    }
  };
  return {
    activateFallback,
    list: () => run(primary.list, fallback.list),
    put: (record) =>
      run(
        () => primary.put(record),
        () => fallback.put(record)
      ),
    remove: (idempotencyKey) =>
      run(
        () => primary.remove(idempotencyKey),
        () => fallback.remove(idempotencyKey)
      )
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed')),
      {
        once: true
      }
    );
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
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB error')),
      {
        once: true
      }
    );
  });
}

export function createIndexedDbBrowserSpoolStore(
  input: {
    databaseName?: string;
    objectStoreName?: string;
  } = {}
): BrowserSpoolStore {
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
      request.addEventListener(
        'error',
        () => reject(request.error ?? new Error('IndexedDB open failed')),
        {
          once: true
        }
      );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvelope(value: unknown): value is TelemetryEnvelopeV1 {
  if (!isRecord(value) || !isRecord(value.error) || !isRecord(value.context)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.eventId === 'string' &&
    value.eventId.startsWith('EVT_') &&
    typeof value.idempotencyKey === 'string' &&
    value.idempotencyKey.length > 0 &&
    typeof value.capturedAt === 'string' &&
    Number.isFinite(Date.parse(value.capturedAt)) &&
    (value.source === 'api' ||
      value.source === 'browser' ||
      value.source === 'database' ||
      value.source === 'document_store' ||
      value.source === 'job' ||
      value.source === 'provider' ||
      value.source === 'process') &&
    (value.level === 'fatal' || value.level === 'error' || value.level === 'warning') &&
    typeof value.error.name === 'string' &&
    typeof value.error.code === 'string' &&
    typeof value.error.safeMessage === 'string' &&
    typeof value.context.release === 'string' &&
    typeof value.context.service === 'string' &&
    typeof value.context.environment === 'string'
  );
}

function isSpoolRecord(value: unknown): value is BrowserSpoolRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.idempotencyKey === 'string' &&
    value.idempotencyKey.length > 0 &&
    typeof value.eventId === 'string' &&
    value.eventId.startsWith('EVT_') &&
    isEnvelope(value.envelope) &&
    value.eventId === value.envelope.eventId &&
    value.idempotencyKey === value.envelope.idempotencyKey &&
    Number.isFinite(value.byteSize) &&
    Number(value.byteSize) >= 0 &&
    typeof value.enqueuedAt === 'string' &&
    Number.isFinite(Date.parse(value.enqueuedAt)) &&
    Number.isSafeInteger(value.attemptCount) &&
    Number(value.attemptCount) >= 0 &&
    (value.nextAttemptAt === undefined ||
      (typeof value.nextAttemptAt === 'string' &&
        Number.isFinite(Date.parse(value.nextAttemptAt)))) &&
    (value.diagnosticCount === undefined ||
      (Number.isSafeInteger(value.diagnosticCount) && Number(value.diagnosticCount) >= 0))
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
  private mutationTail: Promise<void> = Promise.resolve();
  private activeFlush: Promise<{ delivered: number; deferred: number }> | undefined;

  constructor(
    private readonly input: {
      store: BrowserSpoolStore;
      now?: () => Date;
      random?: () => number;
      maxEvents?: number;
      maxBytes?: number;
      maxAgeMilliseconds?: number;
      onCorruptRecord?: (record: unknown) => void;
    }
  ) {
    this.now = input.now ?? (() => new Date());
    this.random = input.random ?? Math.random;
    this.maxEvents = input.maxEvents ?? maximumEvents;
    this.maxBytes = input.maxBytes ?? maximumBytes;
    this.maxAgeMilliseconds = input.maxAgeMilliseconds ?? maximumAgeMilliseconds;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async records(): Promise<BrowserSpoolRecord[]> {
    let rawRecords = (await this.input.store.list()) as unknown[];
    const invalid = rawRecords.filter((record) => !isSpoolRecord(record));
    if (invalid.length > 0) {
      for (const record of invalid) {
        try {
          this.input.onCorruptRecord?.(record);
        } catch {
          // Corruption diagnostics cannot block valid queued occurrences.
        }
      }
      const switchable = this.input.store as SwitchableBrowserSpoolStore;
      if (switchable.activateFallback) {
        const validRecords = rawRecords.filter(isSpoolRecord);
        switchable.activateFallback();
        for (const record of validRecords) await this.input.store.put(record);
        rawRecords = (await this.input.store.list()) as unknown[];
      } else {
        for (const record of invalid) {
          if (isRecord(record) && typeof record.idempotencyKey === 'string') {
            await this.input.store.remove(record.idempotencyKey);
          }
        }
      }
    }
    return chronological(rawRecords.filter(isSpoolRecord));
  }

  enqueue(envelope: TelemetryEnvelopeV1): Promise<{ queued: boolean; evicted: number }> {
    return this.runExclusive(() => this.enqueueOnce(envelope));
  }

  private async enqueueOnce(
    envelope: TelemetryEnvelopeV1
  ): Promise<{ queued: boolean; evicted: number }> {
    const sanitizedEnvelope = sanitizeBrowserTelemetry(envelope).envelope;
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
    const existing = (await this.records()).filter(
      (queued) =>
        queued.idempotencyKey !== record.idempotencyKey &&
        queued.envelope.error.code !== 'BROWSER_TELEMETRY_SPOOL_EVICTED'
    );
    let retainedBytes = 0;
    let evicted = 0;
    const retained: BrowserSpoolRecord[] = [];

    for (const queued of existing) {
      if (
        !Number.isFinite(Date.parse(queued.enqueuedAt)) ||
        Date.parse(queued.enqueuedAt) < cutoff
      ) {
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

  recordEvictionDiagnostic(envelope: TelemetryEnvelopeV1, evicted: number): Promise<void> {
    if (!Number.isSafeInteger(evicted) || evicted <= 0) return Promise.resolve();
    return this.runExclusive(async () => {
      const existing = (await this.records()).find(
        (record) => record.envelope.error.code === 'BROWSER_TELEMETRY_SPOOL_EVICTED'
      );
      const diagnosticCount = Math.min(
        Number.MAX_SAFE_INTEGER,
        evicted + (existing?.diagnosticCount ?? 0)
      );
      const eventId = existing?.eventId ?? createBrowserEventId();
      const diagnostic = sanitizeBrowserTelemetry({
        ...envelope,
        eventId,
        idempotencyKey: eventId,
        capturedAt: this.now().toISOString(),
        level: 'warning',
        error: {
          name: 'BrowserTelemetrySpoolWarning',
          code: 'BROWSER_TELEMETRY_SPOOL_EVICTED',
          safeMessage: `Browser telemetry spool evicted ${diagnosticCount} event(s)`
        }
      }).envelope;
      if (existing && existing.idempotencyKey !== diagnostic.idempotencyKey) {
        await this.input.store.remove(existing.idempotencyKey);
      }
      await this.input.store.put({
        idempotencyKey: diagnostic.idempotencyKey,
        eventId: diagnostic.eventId,
        envelope: diagnostic,
        byteSize: byteSize(diagnostic),
        enqueuedAt: this.now().toISOString(),
        attemptCount: 0,
        diagnosticCount
      });
    });
  }

  flush(
    deliver: (envelope: TelemetryEnvelopeV1) => Promise<{ acknowledgedIdempotencyKey: string }>
  ): Promise<{ delivered: number; deferred: number }> {
    if (this.activeFlush) return this.activeFlush;
    const operation = this.runExclusive(() => this.flushOnce(deliver));
    this.activeFlush = operation;
    void operation.then(
      () => {
        if (this.activeFlush === operation) this.activeFlush = undefined;
      },
      () => {
        if (this.activeFlush === operation) this.activeFlush = undefined;
      }
    );
    return operation;
  }

  private async flushOnce(
    deliver: (envelope: TelemetryEnvelopeV1) => Promise<{ acknowledgedIdempotencyKey: string }>
  ): Promise<{ delivered: number; deferred: number }> {
    const currentTime = this.now();
    const cutoff = currentTime.getTime() - this.maxAgeMilliseconds;
    let delivered = 0;
    let deferred = 0;

    for (const queued of await this.records()) {
      const enqueuedAt = Date.parse(queued.enqueuedAt);
      if (
        queued.envelope.error.code !== 'BROWSER_TELEMETRY_SPOOL_EVICTED' &&
        (!Number.isFinite(enqueuedAt) || enqueuedAt < cutoff)
      ) {
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
