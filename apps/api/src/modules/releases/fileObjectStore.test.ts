import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileObjectStore } from './fileObjectStore.js';

const roots: string[] = [];

async function createStore(): Promise<{ root: string; store: FileObjectStore }> {
  const root = await mkdtemp(join(tmpdir(), 'edutrack-ops-objects-'));
  roots.push(root);
  return { root, store: new FileObjectStore(root) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileObjectStore', () => {
  it('atomically creates a private object and makes an identical retry idempotent', async () => {
    const { root, store } = await createStore();
    const key = 'source-maps/edutrack-web/0123456789abcdef0123456789abcdef01234567/map.map';
    const content = '{"version":3,"sources":[]}';
    const sha256 = 'b5691f8a847392ee794040463cee258770a825b5f15b9eceb1699c55f5fbbc5d';

    await expect(store.putIfAbsent(key, content, sha256)).resolves.toBe('created');
    await expect(store.putIfAbsent(key, content, sha256)).resolves.toBe('identical');
    expect(await readFile(join(root, key), 'utf8')).toBe(content);
    expect((await lstat(join(root, key))).mode & 0o777).toBe(0o600);
  });

  it('rejects a mismatched checksum, duplicate content conflict and traversal key', async () => {
    const { store } = await createStore();
    const key = 'source-maps/edutrack-web/0123456789abcdef0123456789abcdef01234567/map.map';
    const content = '{"version":3,"sources":[]}';

    await expect(store.putIfAbsent(key, content, '0'.repeat(64))).rejects.toThrow(/checksum/i);
    await store.putIfAbsent(
      key,
      content,
      'b5691f8a847392ee794040463cee258770a825b5f15b9eceb1699c55f5fbbc5d'
    );
    await expect(
      store.putIfAbsent(
        key,
        '{"version":3,"sources":["other"]}',
        'c5b5554dbedeef01b9b8e3df5f676299db19c7144b3c8dcfb373d58dedfd9d7f'
      )
    ).resolves.toBe('conflict');
    await expect(
      store.putIfAbsent(
        '../outside.map',
        content,
        'b5691f8a847392ee794040463cee258770a825b5f15b9eceb1699c55f5fbbc5d'
      )
    ).rejects.toThrow(/object key/i);
  });
});
