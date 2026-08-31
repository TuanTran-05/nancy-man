import { lstat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createEnvelopeKey } from '../crypto/encryptedEnvelope.js';
import { DraftStore } from '../changes/draftStore.js';
import { SnapshotStore } from '../changes/snapshotStore.js';
import { RetentionService } from './retentionService.js';

const stagingKey = createEnvelopeKey({
  purpose: 'staging',
  keyId: 'staging-v1',
  keyVersion: 'v1',
  bytes: Buffer.alloc(32, 0x51)
});
const snapshotKey = createEnvelopeKey({
  purpose: 'snapshot',
  keyId: 'snapshot-v1',
  keyVersion: 'v1',
  bytes: Buffer.alloc(32, 0x61)
});
const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'edutrack-config-agent-retention-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  roots.length = 0;
});

describe('RetentionService', () => {
  test('expires drafts and staged artifacts after 24 hours and keeps successful snapshots for 30 days', async () => {
    const stateDirectory = await root();
    const drafts = new DraftStore({ stateDirectory, stagingKey: stagingKey });
    const snapshots = new SnapshotStore({ stateDirectory, snapshotKey });
    const createdAt = new Date('2026-08-31T00:00:00.000Z');
    await drafts.replaceDraft({
      changeId: 'draft-old',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { secret: 'draft-secret' },
      now: createdAt
    });
    await drafts.saveStaged({
      changeId: 'staged-old',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { secret: 'staged-secret' },
      now: createdAt
    });
    await snapshots.createSnapshot({
      snapshotId: 'snapshot-new',
      changeId: 'change-1',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { secret: 'snapshot-secret' },
      now: createdAt
    });

    const service = new RetentionService({ stateDirectory });
    const result = await service.cleanup(new Date('2026-09-29T00:00:00.000Z'));

    expect(result).toEqual(
      expect.objectContaining({
        deletedDraftIds: ['draft-old'],
        deletedStagedIds: ['staged-old'],
        deletedSnapshotIds: [],
        retainedRollbackFailedIds: []
      })
    );
    expect(await lstat(join(stateDirectory, 'snapshots', 'snapshot-new.enc'))).toBeTruthy();
  });

  test('retains rollback-failed evidence and cleanup is idempotent', async () => {
    const stateDirectory = await root();
    const snapshots = new SnapshotStore({ stateDirectory, snapshotKey });
    await snapshots.createSnapshot({
      snapshotId: 'snapshot-failed',
      changeId: 'change-failed',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { secret: 'rollback-secret-sentinel' },
      now: new Date('2026-01-01T00:00:00.000Z')
    });
    await snapshots.markRollbackFailed('snapshot-failed');

    const service = new RetentionService({ stateDirectory });
    const first = await service.cleanup(new Date('2026-08-31T00:00:00.000Z'));
    const second = await service.cleanup(new Date('2026-08-31T00:00:00.000Z'));

    expect(first.retainedRollbackFailedIds).toEqual(['snapshot-failed']);
    expect(second).toEqual(first);
    expect(await lstat(join(stateDirectory, 'snapshots', 'snapshot-failed.enc'))).toBeTruthy();
    expect(JSON.stringify(first)).not.toContain('rollback-secret-sentinel');
  });
});
