import { mkdtemp, readFile, stat } from 'node:fs/promises';
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
