import { lstat, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createEnvelopeKey } from '../crypto/encryptedEnvelope.js';
import { SnapshotStore } from './snapshotStore.js';

const key = createEnvelopeKey({
  purpose: 'snapshot',
  keyId: 'snapshot-v1',
  keyVersion: 'v1',
  bytes: Buffer.alloc(32, 0x42)
});
const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'edutrack-config-agent-snapshots-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  roots.length = 0;
});

describe('SnapshotStore', () => {
  test('stores and restores exact source bytes and metadata in a snapshot envelope', async () => {
    const stateDirectory = await root();
    const store = new SnapshotStore({ stateDirectory, snapshotKey: key });
    const snapshot = {
      sources: [
        {
          sourceId: 'api.env',
          bytes: Buffer.from('TOKEN=snapshot-secret-sentinel\r\n'),
          metadata: { uid: 1000, gid: 1000, mode: 0o640, mtimeMs: 1234, nlink: 1 }
        }
      ],
      activeRelease: { releaseId: 'release-1', releasePath: '/srv/releases/release-1' },
      processState: { service: 'edutrack-ops-api.service', active: true }
    };

    await store.createSnapshot({
      snapshotId: 'snapshot-1',
      changeId: 'change-1',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: snapshot,
      now: new Date('2026-08-31T00:00:00.000Z')
    });
    expect(
      await store.readSnapshot('snapshot-1', new Date('2026-08-31T01:00:00.000Z'))
    ).toEqual(snapshot);
    const artifact = await readFile(join(stateDirectory, 'snapshots', 'snapshot-1.enc'));
    expect(artifact.toString('utf8')).not.toContain('snapshot-secret-sentinel');
    expect((await lstat(join(stateDirectory, 'snapshots', 'snapshot-1.enc'))).mode & 0o777).toBe(0o600);
  });

  test('marks rollback-failed evidence so retention may not delete it', async () => {
    const stateDirectory = await root();
    const store = new SnapshotStore({ stateDirectory, snapshotKey: key });
    await store.createSnapshot({
      snapshotId: 'snapshot-2',
      changeId: 'change-2',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { exact: 'evidence-secret' },
      now: new Date('2026-08-31T00:00:00.000Z')
    });
    await store.markRollbackFailed('snapshot-2');
    expect(await store.getRetentionEntries()).toEqual([
      expect.objectContaining({ snapshotId: 'snapshot-2', retention: 'rollback_failed' })
    ]);
    await expect(
      store.readSnapshot('snapshot-2', new Date('2026-10-01T00:00:00.000Z'))
    ).resolves.toEqual({ exact: 'evidence-secret' });
  });

  test('rejects a snapshot after its retention expiry and supports explicit evidence release', async () => {
    const stateDirectory = await root();
    const store = new SnapshotStore({ stateDirectory, snapshotKey: key });
    await store.createSnapshot({
      snapshotId: 'snapshot-3',
      changeId: 'change-3',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { exact: 'secret' },
      now: new Date('2026-08-31T00:00:00.000Z')
    });
    await expect(
      store.readSnapshot('snapshot-3', new Date('2026-10-01T00:00:00.000Z'))
    ).resolves.toBeNull();
    await store.markRollbackFailed('snapshot-3');
    await store.releaseRollbackEvidence('snapshot-3', new Date('2026-10-01T00:00:00.000Z'));
    expect(await store.getRetentionEntries()).toEqual([]);
  });
});
