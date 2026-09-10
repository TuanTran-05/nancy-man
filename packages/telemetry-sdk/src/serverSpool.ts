import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { sanitizeTelemetry } from '../../security/src/telemetry/sanitizer.js';

const maximumBytes = 64 * 1024 * 1024;
const maximumAgeMilliseconds = 24 * 60 * 60 * 1_000;
const ingestEventIdPattern = /^EVT_[0-9A-HJKMNP-TV-Z]{26}$/;

export type ServerSpoolRecord = {
  idempotencyKey: string;
  eventId: `EVT_${string}`;
  envelope: TelemetryEnvelopeV1;
  byteSize: number;
  enqueuedAt: string;
  attemptCount: number;
  nextAttemptAt?: string;
};

type QuarantineSummary = {
  schemaVersion: 1;
  quarantinedAt: string;
  malformedRecords: number;
  invalidRecords: number;
};

function encodedSize(record: Omit<ServerSpoolRecord, 'byteSize'>): number {
  return Buffer.byteLength(`${JSON.stringify(record)}\n`, 'utf8');
}

function chronological(records: ServerSpoolRecord[]): ServerSpoolRecord[] {
  return [...records].sort(
    (left, right) =>
      Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt) ||
      left.idempotencyKey.localeCompare(right.idempotencyKey)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyStringValues(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isIngestEventId(value: unknown): value is `EVT_${string}` {
  return typeof value === 'string' && ingestEventIdPattern.test(value);
}

function isIngestIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16;
}

function isBreadcrumb(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.at === 'string' &&
    typeof value.category === 'string' &&
    typeof value.message === 'string'
  );
}

function isEnvelope(value: unknown): value is TelemetryEnvelopeV1 {
  if (!isRecord(value) || !isRecord(value.error) || !isRecord(value.context)) return false;
  const source = value.source;
  const level = value.level;
  const error = value.error;
  const context = value.context;
  return (
    value.schemaVersion === 1 &&
    isIngestEventId(value.eventId) &&
    isIngestIdempotencyKey(value.idempotencyKey) &&
    typeof value.capturedAt === 'string' &&
    Number.isFinite(Date.parse(value.capturedAt)) &&
    (source === 'api' ||
      source === 'database' ||
      source === 'document_store' ||
      source === 'job' ||
      source === 'provider' ||
      source === 'process' ||
      source === 'deployment' ||
      source === 'synthetic') &&
    (level === 'fatal' || level === 'error' || level === 'warning') &&
    typeof error.name === 'string' &&
    typeof error.code === 'string' &&
    typeof error.safeMessage === 'string' &&
    (error.stack === undefined || typeof error.stack === 'string') &&
    (error.componentStack === undefined || typeof error.componentStack === 'string') &&
    typeof context.release === 'string' &&
    typeof context.service === 'string' &&
    context.environment === 'production' &&
    (context.requestId === undefined || typeof context.requestId === 'string') &&
    (context.traceId === undefined || typeof context.traceId === 'string') &&
    (context.route === undefined || typeof context.route === 'string') &&
    (context.telemetryContextToken === undefined ||
      typeof context.telemetryContextToken === 'string') &&
    (context.tags === undefined || hasOnlyStringValues(context.tags)) &&
    (context.breadcrumbs === undefined ||
      (Array.isArray(context.breadcrumbs) && context.breadcrumbs.every(isBreadcrumb)))
  );
}

function normalizeSpoolRecord(value: unknown): ServerSpoolRecord | undefined {
  if (!isRecord(value) || !isEnvelope(value.envelope)) return undefined;
  if (
    !isIngestIdempotencyKey(value.idempotencyKey) ||
    !isIngestEventId(value.eventId) ||
    value.eventId !== value.envelope.eventId ||
    value.idempotencyKey !== value.envelope.idempotencyKey ||
    !Number.isSafeInteger(value.byteSize) ||
    Number(value.byteSize) < 0 ||
    typeof value.enqueuedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.enqueuedAt)) ||
    !Number.isSafeInteger(value.attemptCount) ||
    Number(value.attemptCount) < 0 ||
    (value.nextAttemptAt !== undefined &&
      (typeof value.nextAttemptAt !== 'string' ||
        !Number.isFinite(Date.parse(value.nextAttemptAt))))
  ) {
    return undefined;
  }

  const envelope = sanitizeTelemetry(value.envelope, {
    sessionPepper: 'server-telemetry-session-id-not-provided'
  }).envelope;
  const withoutSize = {
    idempotencyKey: envelope.idempotencyKey,
    eventId: envelope.eventId,
    envelope,
    enqueuedAt: value.enqueuedAt,
    attemptCount: Number(value.attemptCount),
    ...(typeof value.nextAttemptAt === 'string' ? { nextAttemptAt: value.nextAttemptAt } : {})
  };
  return { ...withoutSize, byteSize: encodedSize(withoutSize) };
}

function isAllowedDirectory(allowedRoot: string, spoolDirectory: string): boolean {
  const pathToSpool = relative(allowedRoot, spoolDirectory);
  return pathToSpool === '' || (!pathToSpool.startsWith('..') && !isAbsolute(pathToSpool));
}

export class ServerSpool {
  private readonly allowedRoot: string;
  private readonly spoolDirectory: string;
  private readonly eventPath: string;
  private readonly quarantinePath: string;
  private readonly lockPath: string;
  private readonly now: () => Date;
  private readonly random: () => string;
  private readonly maxBytes: number;
  private readonly maxAgeMilliseconds: number;

  constructor(input: {
    allowedRoot: string;
    spoolDirectory: string;
    now?: () => Date;
    random?: () => string;
    maxBytes?: number;
    maxAgeMilliseconds?: number;
  }) {
    this.allowedRoot = resolve(input.allowedRoot);
    this.spoolDirectory = resolve(input.spoolDirectory);
    if (!isAllowedDirectory(this.allowedRoot, this.spoolDirectory)) {
      throw new Error('Server spool directory must be inside the allowlisted root');
    }
    this.eventPath = join(this.spoolDirectory, 'events.ndjson');
    this.quarantinePath = join(this.spoolDirectory, 'quarantine.ndjson');
    this.lockPath = join(this.spoolDirectory, '.events.lock');
    this.now = input.now ?? (() => new Date());
    this.random =
      input.random ?? (() => createHash('sha256').update(String(Math.random())).digest('hex'));
    this.maxBytes = input.maxBytes ?? maximumBytes;
    this.maxAgeMilliseconds = input.maxAgeMilliseconds ?? maximumAgeMilliseconds;
  }

  async enqueue(envelope: TelemetryEnvelopeV1): Promise<{ queued: boolean; evicted: number }> {
    const sanitizedEnvelope = sanitizeTelemetry(envelope, {
      sessionPepper: 'server-telemetry-session-id-not-provided'
    }).envelope;
    const currentTime = this.now();
    const candidateWithoutSize = {
      idempotencyKey: sanitizedEnvelope.idempotencyKey,
      eventId: sanitizedEnvelope.eventId,
      envelope: sanitizedEnvelope,
      enqueuedAt: currentTime.toISOString(),
      attemptCount: 0
    };
    const candidate: ServerSpoolRecord = {
      ...candidateWithoutSize,
      byteSize: encodedSize(candidateWithoutSize)
    };
    if (candidate.byteSize > this.maxBytes) {
      return { queued: false, evicted: 0 };
    }

    return this.withLock(async () => {
      const cutoff = currentTime.getTime() - this.maxAgeMilliseconds;
      const current = chronological(await this.readRecords()).filter(
        (record) => record.idempotencyKey !== candidate.idempotencyKey
      );
      const retained: ServerSpoolRecord[] = [];
      let retainedBytes = 0;
      let evicted = 0;
      for (const record of current) {
        if (
          !Number.isFinite(Date.parse(record.enqueuedAt)) ||
          Date.parse(record.enqueuedAt) < cutoff
        ) {
          evicted += 1;
          continue;
        }
        retained.push(record);
        retainedBytes += record.byteSize;
      }
      while (retained.length > 0 && retainedBytes + candidate.byteSize > this.maxBytes) {
        const oldest = retained.shift();
        if (!oldest) break;
        retainedBytes -= oldest.byteSize;
        evicted += 1;
      }
      retained.push(candidate);
      await this.writeRecords(retained);
      return { queued: true, evicted };
    });
  }

  async pending(): Promise<ServerSpoolRecord[]> {
    return this.withLock(async () => chronological(await this.readRecords()));
  }

  async flush(
    deliver: (envelope: TelemetryEnvelopeV1) => Promise<{ acknowledgedIdempotencyKey: string }>
  ): Promise<{ delivered: number; deferred: number }> {
    return this.withLock(async () => {
      const currentTime = this.now();
      const cutoff = currentTime.getTime() - this.maxAgeMilliseconds;
      let delivered = 0;
      let deferred = 0;
      const retained: ServerSpoolRecord[] = [];

      for (const record of chronological(await this.readRecords())) {
        const enqueuedAt = Date.parse(record.enqueuedAt);
        if (!Number.isFinite(enqueuedAt) || enqueuedAt < cutoff) {
          continue;
        }
        const nextAttemptAt = record.nextAttemptAt ? Date.parse(record.nextAttemptAt) : null;
        if (nextAttemptAt && nextAttemptAt > currentTime.getTime()) {
          retained.push(record);
          deferred += 1;
          continue;
        }

        try {
          const acknowledgement = await deliver(record.envelope);
          if (acknowledgement.acknowledgedIdempotencyKey !== record.idempotencyKey) {
            throw new Error('Collector acknowledgement did not match the queued idempotency key');
          }
          delivered += 1;
        } catch {
          const attemptCount = record.attemptCount + 1;
          const baseDelay = Math.min(15 * 60 * 1_000, 1_000 * 2 ** Math.min(attemptCount, 10));
          const jitter = 0.5 + (Number.parseInt(this.random().slice(0, 8), 16) / 0xffffffff || 0);
          retained.push({
            ...record,
            attemptCount,
            nextAttemptAt: new Date(
              currentTime.getTime() + Math.round(baseDelay * jitter)
            ).toISOString()
          });
          deferred += 1;
        }
      }

      await this.writeRecords(retained);
      return { delivered, deferred };
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.spoolDirectory, { recursive: true, mode: 0o700 });
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        lock = await open(this.lockPath, 'wx', 0o600);
        break;
      } catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
          throw error;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    }
    if (!lock) {
      throw new Error('Timed out waiting for the server telemetry spool lock');
    }

    try {
      return await operation();
    } finally {
      await lock.close();
      await unlink(this.lockPath).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      });
    }
  }

  private async readRecords(): Promise<ServerSpoolRecord[]> {
    try {
      const content = await readFile(this.eventPath, 'utf8');
      const records: ServerSpoolRecord[] = [];
      let malformedRecords = 0;
      let invalidRecords = 0;
      let normalized = false;

      for (const line of content.split('\n').filter(Boolean)) {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          malformedRecords += 1;
          continue;
        }
        const record = normalizeSpoolRecord(raw);
        if (!record) {
          invalidRecords += 1;
          continue;
        }
        records.push(record);
        normalized ||= JSON.stringify(raw) !== JSON.stringify(record);
      }

      if (malformedRecords > 0 || invalidRecords > 0) {
        await this.writeQuarantine({
          schemaVersion: 1,
          quarantinedAt: this.now().toISOString(),
          malformedRecords,
          invalidRecords
        });
        await this.writeRecords(records);
      } else if (normalized) {
        await this.writeRecords(records);
      }
      return records;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeQuarantine(summary: QuarantineSummary): Promise<void> {
    const temporaryPath = join(this.spoolDirectory, `.quarantine.${this.random()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(summary)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.quarantinePath);
    await chmod(this.quarantinePath, 0o600);
  }

  private async writeRecords(records: ServerSpoolRecord[]): Promise<void> {
    const content = records.map((record) => JSON.stringify(record)).join('\n');
    const normalized = content ? `${content}\n` : '';
    const temporaryPath = join(this.spoolDirectory, `.events.${this.random()}.tmp`);
    await writeFile(temporaryPath, normalized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.eventPath);
    await chmod(this.eventPath, 0o600);
  }
}
