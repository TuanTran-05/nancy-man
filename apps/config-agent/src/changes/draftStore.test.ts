import { chmod, lstat, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createEnvelopeKey } from '../crypto/encryptedEnvelope.js';
import { DraftStore } from './draftStore.js';

const key = createEnvelopeKey({
  purpose: 'staging',
  keyId: 'staging-v1',
  keyVersion: 'v1',
  bytes: Buffer.alloc(32, 0x31)
});
const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'edutrack-config-agent-drafts-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  roots.length = 0;
});

describe('DraftStore', () => {
  test('replaces an encrypted draft and seals it into staged storage without plaintext', async () => {
    const stateDirectory = await root();
    const store = new DraftStore({ stateDirectory, stagingKey: key });
    const draft = {
      patch: 'draft-secret-sentinel',
      sourceFingerprints: { 'api.env': 'hmac-sha256:v1:abc' }
    };

    await store.replaceDraft({
      changeId: 'change-1',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: draft,
      now: new Date('2026-08-31T00:00:00.000Z')
    });
    expect(await store.readDraft('change-1', new Date('2026-08-31T01:00:00.000Z'))).toEqual(draft);

    await store.sealDraft({
      changeId: 'change-1',
      now: new Date('2026-08-31T02:00:00.000Z')
    });
    expect(await store.readDraft('change-1', new Date('2026-08-31T02:00:00.000Z'))).toBeNull();
    expect(await store.readStaged('change-1', new Date('2026-08-31T03:00:00.000Z'))).toEqual(draft);

    const files = await Promise.all([
      readFile(join(stateDirectory, 'drafts', 'change-1.enc')),
      readFile(join(stateDirectory, 'staged', 'change-1.enc'))
    ].map((promise) => promise.catch(() => Buffer.alloc(0))));
    expect(Buffer.concat(files).toString('utf8')).not.toContain('draft-secret-sentinel');
  });

  test('creates 0700 directories and 0600 artifacts with a value-free index', async () => {
    const stateDirectory = await root();
    const store = new DraftStore({ stateDirectory, stagingKey: key });
    await store.replaceDraft({
      changeId: 'change-2',
      appId: 'web',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { value: 'index-secret-sentinel' },
      now: new Date('2026-08-31T00:00:00.000Z')
    });

    for (const directory of ['drafts', 'staged', 'snapshots', 'locks']) {
      const details = await lstat(join(stateDirectory, directory));
      expect(details.mode & 0o777).toBe(0o700);
    }
    const artifact = await lstat(join(stateDirectory, 'drafts', 'change-2.enc'));
    expect(artifact.mode & 0o777).toBe(0o600);
    const index = await readFile(join(stateDirectory, 'drafts', 'index.json'), 'utf8');
    expect(index).toContain('change-2');
    expect(index).not.toContain('index-secret-sentinel');
  });

  test('rejects symlinked artifacts and expired drafts', async () => {
    const stateDirectory = await root();
    const store = new DraftStore({ stateDirectory, stagingKey: key });
    await store.replaceDraft({
      changeId: 'change-3',
      appId: 'api',
      catalogVersion: 'catalog-1',
      manifestVersion: 'manifest-1',
      value: { safe: true },
      now: new Date('2026-08-31T00:00:00.000Z')
    });
    await symlink('change-3.enc', join(stateDirectory, 'drafts', 'link.enc'));
    await expect(store.readDraft('link', new Date('2026-08-31T01:00:00.000Z'))).rejects.toThrow(
      /symlink|metadata|artifact/i
    );
    await expect(store.readDraft('change-3', new Date('2026-09-01T00:00:00.001Z'))).resolves.toBeNull();

    await chmod(join(stateDirectory, 'drafts', 'index.json'), 0o644);
    await expect(
      store.replaceDraft({
        changeId: 'change-4',
        appId: 'api',
        catalogVersion: 'catalog-1',
        manifestVersion: 'manifest-1',
        value: { safe: true },
        now: new Date('2026-08-31T00:00:00.000Z')
      })
    ).rejects.toThrow(/metadata|permission|mode/i);
    await writeFile(join(stateDirectory, 'drafts', 'index.json'), '{}');
  });

  test('requires the configured exact directory owner', async () => {
    const stateDirectory = await root();
    const currentUid = process.getuid?.() ?? 0;
    const store = new DraftStore({
      stateDirectory,
      stagingKey: key,
      ownerUid: currentUid + 1
    });

    await expect(
      store.replaceDraft({
        changeId: 'change-owner',
        appId: 'api',
        catalogVersion: 'catalog-1',
        manifestVersion: 'manifest-1',
        value: { safe: true }
      })
    ).rejects.toThrow(/metadata|directory/i);
  });
});
