import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';
import { afterEach, describe, expect, it } from 'vitest';

import { ServerSpool } from './serverSpool.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => {
      await import('node:fs/promises').then(({ rm }) =>
        rm(directory, { recursive: true, force: true })
      );
    })
  );
});

function envelope(eventId: `EVT_${string}`): TelemetryEnvelopeV1 {
  return {
    schemaVersion: 1,
    eventId,
    idempotencyKey: `idem-${eventId}`,
    capturedAt: '2026-08-22T08:00:00.000Z',
    source: 'api',
    level: 'error',
    error: { name: 'Error', code: 'SERVER_EXCEPTION', safeMessage: 'safe server failure' },
    context: { release: 'release', service: 'edutrack-api', environment: 'production' }
  };
}

async function createSpool(): Promise<{ spool: ServerSpool; directory: string }> {
  const root = await mkdtemp(join(tmpdir(), 'edutrack-ops-spool-'));
  temporaryRoots.push(root);
  const directory = join(root, 'edutrack-api');
  return {
    directory,
    spool: new ServerSpool({
      allowedRoot: root,
      spoolDirectory: directory,
      now: () => new Date('2026-08-22T08:00:00.000Z'),
      random: () => 'fixed'
    })
  };
}

describe('ServerSpool', () => {
  it('writes only sanitized NDJSON records with mode 0600 inside the configured allowlist', async () => {
    const { spool, directory } = await createSpool();
    const unsafe = envelope('EVT_00000000000000000000000001');
    unsafe.error.safeMessage = 'password=never-write';

    await expect(spool.enqueue(unsafe)).resolves.toEqual({ queued: true, evicted: 0 });

    const spoolFile = join(directory, 'events.ndjson');
    expect((await stat(spoolFile)).mode & 0o777).toBe(0o600);
    await expect(readFile(spoolFile, 'utf8')).resolves.not.toMatch(/password=never-write/i);
    await expect(spool.pending()).resolves.toHaveLength(1);
  });

  it('keeps failed delivery records and removes only collector-acknowledged idempotency keys', async () => {
    const { spool } = await createSpool();
    const first = envelope('EVT_00000000000000000000000002');
    const second = envelope('EVT_00000000000000000000000003');
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

    await expect(spool.pending()).resolves.toMatchObject([
      { eventId: second.eventId, attemptCount: 1 }
    ]);
  });

  it('quarantines a malformed line without blocking a valid later record', async () => {
    const { spool, directory } = await createSpool();
    const valid = envelope('EVT_00000000000000000000000004');
    await spool.enqueue(valid);
    const eventPath = join(directory, 'events.ndjson');
    const validLine = (await readFile(eventPath, 'utf8')).trim();
    const rawSecret = 'password=must-never-survive-quarantine';
    await writeFile(eventPath, `{${rawSecret}\n${validLine}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });

    const delivered: string[] = [];
    await expect(
      spool.flush(async (queued) => {
        delivered.push(queued.eventId);
        return { acknowledgedIdempotencyKey: queued.idempotencyKey };
      })
    ).resolves.toEqual({ delivered: 1, deferred: 0 });

    expect(delivered).toEqual([valid.eventId]);
    const files = await readdir(directory);
    expect(files).toContain('quarantine.ndjson');
    await expect(stat(join(directory, 'quarantine.ndjson'))).resolves.toMatchObject({
      mode: expect.any(Number)
    });
    expect((await stat(join(directory, 'quarantine.ndjson'))).mode & 0o777).toBe(0o600);
    for (const file of files) {
      await expect(readFile(join(directory, file), 'utf8')).resolves.not.toContain(rawSecret);
    }
  });

  it('re-sanitizes a valid-shaped persisted record before delivery', async () => {
    const { spool, directory } = await createSpool();
    const valid = envelope('EVT_00000000000000000000000008');
    await spool.enqueue(valid);
    const eventPath = join(directory, 'events.ndjson');
    const persisted = JSON.parse((await readFile(eventPath, 'utf8')).trim()) as {
      envelope: TelemetryEnvelopeV1;
    };
    persisted.envelope.error.safeMessage = 'password=must-not-reach-collector';
    await writeFile(eventPath, `${JSON.stringify(persisted)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });

    const delivered: TelemetryEnvelopeV1[] = [];
    await expect(
      spool.flush(async (queued) => {
        delivered.push(queued);
        return { acknowledgedIdempotencyKey: queued.idempotencyKey };
      })
    ).resolves.toEqual({ delivered: 1, deferred: 0 });

    expect(JSON.stringify(delivered)).not.toContain('must-not-reach-collector');
    expect(delivered[0]?.error.safeMessage).toContain('[REDACTED]');
  });

  it('quarantines an invalid record while preserving later enqueue and delivery', async () => {
    const { spool, directory } = await createSpool();
    const first = envelope('EVT_00000000000000000000000005');
    const second = envelope('EVT_00000000000000000000000006');
    await spool.enqueue(first);
    const eventPath = join(directory, 'events.ndjson');
    const firstLine = (await readFile(eventPath, 'utf8')).trim();
    const unsafeInvalidRecord = {
      idempotencyKey: 'invalid-secret-record',
      eventId: 'EVT_00000000000000000000000007',
      envelope: {
        ...envelope('EVT_00000000000000000000000007'),
        error: { name: 'Error', code: 42, safeMessage: 'token=must-not-survive' }
      },
      byteSize: 1,
      enqueuedAt: '2026-08-22T08:00:00.000Z',
      attemptCount: 0
    };
    await writeFile(eventPath, `${JSON.stringify(unsafeInvalidRecord)}\n${firstLine}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });

    await expect(spool.enqueue(second)).resolves.toEqual({ queued: true, evicted: 0 });
    const delivered: string[] = [];
    await expect(
      spool.flush(async (queued) => {
        delivered.push(queued.eventId);
        return { acknowledgedIdempotencyKey: queued.idempotencyKey };
      })
    ).resolves.toEqual({ delivered: 2, deferred: 0 });

    expect(delivered.sort()).toEqual([first.eventId, second.eventId].sort());
    const stored = await Promise.all(
      (await readdir(directory)).map((file) => readFile(join(directory, file), 'utf8'))
    );
    expect(stored.join('\n')).not.toContain('must-not-survive');
  });

  it('quarantines persisted identities that the server ingest contract would reject', async () => {
    const { spool, directory } = await createSpool();
    const valid = envelope('EVT_00000000000000000000000009');
    await spool.enqueue(valid);
    const eventPath = join(directory, 'events.ndjson');
    const validRecord = JSON.parse((await readFile(eventPath, 'utf8')).trim()) as Record<
      string,
      unknown
    >;
    const invalidEventId = {
      ...validRecord,
      eventId: 'EVT_TOO_SHORT',
      idempotencyKey: 'valid-idempotency',
      envelope: {
        ...(validRecord.envelope as Record<string, unknown>),
        eventId: 'EVT_TOO_SHORT',
        idempotencyKey: 'valid-idempotency'
      }
    };
    const invalidIdempotencyKey = {
      ...validRecord,
      idempotencyKey: 'too-short',
      envelope: {
        ...(validRecord.envelope as Record<string, unknown>),
        idempotencyKey: 'too-short'
      }
    };
    const invalidServerSource = {
      ...validRecord,
      envelope: {
        ...(validRecord.envelope as Record<string, unknown>),
        source: 'browser'
      }
    };
    await writeFile(
      eventPath,
      `${JSON.stringify(invalidEventId)}\n${JSON.stringify(invalidIdempotencyKey)}\n${JSON.stringify(invalidServerSource)}\n${JSON.stringify(validRecord)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );

    const delivered: string[] = [];
    await expect(
      spool.flush(async (queued) => {
        delivered.push(queued.eventId);
        return { acknowledgedIdempotencyKey: queued.idempotencyKey };
      })
    ).resolves.toEqual({ delivered: 1, deferred: 0 });

    expect(delivered).toEqual([valid.eventId]);
    await expect(readFile(join(directory, 'quarantine.ndjson'), 'utf8')).resolves.toContain(
      '"invalidRecords":3'
    );
  });

  it('refuses a directory outside the configured spool root', () => {
    expect(
      () =>
        new ServerSpool({
          allowedRoot: '/var/lib/edutrack-ops-spool',
          spoolDirectory: '/tmp/not-allowed'
        })
    ).toThrow(/allowlisted/i);
  });
});
