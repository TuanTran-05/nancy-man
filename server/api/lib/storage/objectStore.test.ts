import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getObjectStore,
  normalizeObjectPath,
  verifyLocalReadUrl,
} from './objectStore.js';

describe('local object store', () => {
  let storageRoot = '';
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), 'edutrack-object-store-'));
    env = {
      STORAGE_BACKEND: 'local',
      STORAGE_LOCAL_ROOT: storageRoot,
      STORAGE_SIGNING_SECRET: 'test-storage-signing-secret-at-least-32-characters',
      PUBLIC_BASE_URL: 'https://vps.thienuy.edu.vn',
    };
  });

  afterEach(async () => {
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('saves, reads, describes, and deletes an object', async () => {
    const store = getObjectStore(env);
    await store.save('documents/example.txt', Buffer.from('hello'), {
      contentType: 'text/plain',
      metadata: { owner: 'teacher-1' },
    });

    expect(await store.exists('documents/example.txt')).toBe(true);
    expect(await store.download('documents/example.txt')).toEqual(Buffer.from('hello'));
    expect(await store.stat('documents/example.txt')).toMatchObject({
      size: 5,
      contentType: 'text/plain',
      metadata: { owner: 'teacher-1' },
    });

    await store.delete('documents/example.txt');
    expect(await store.exists('documents/example.txt')).toBe(false);
  });

  it('creates verifiable expiring and persistent read URLs', async () => {
    const store = getObjectStore(env);
    const signedUrl = await store.createSignedReadUrl('documents/example.pdf', {
      expiresMs: 60_000,
      contentType: 'application/pdf',
      responseDisposition: 'attachment; filename="example.pdf"',
    });
    const signed = new URL(signedUrl);
    const verified = verifyLocalReadUrl(Object.fromEntries(signed.searchParams), env);
    expect(verified).toMatchObject({
      objectPath: 'documents/example.pdf',
      contentType: 'application/pdf',
      responseDisposition: 'attachment; filename="example.pdf"',
    });

    const persistentUrl = await store.createPersistentReadUrl('images/avatar.png', {
      contentType: 'image/png',
    });
    const persistent = new URL(persistentUrl);
    expect(verifyLocalReadUrl(Object.fromEntries(persistent.searchParams), env).expiresAt).toBe(0);
  });

  it('removes orphan metadata when the object is already missing', async () => {
    const store = getObjectStore(env);
    const objectPath = 'documents/orphan.txt';
    const diskPath = path.join(storageRoot, 'documents', 'orphan.txt');
    const metadataPath = `${diskPath}.edutrack-meta.json`;
    await store.save(objectPath, Buffer.from('temporary'));
    await rm(diskPath);

    await store.delete(objectPath, { ignoreNotFound: true });

    await expect(stat(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects path traversal, tampered signatures, and expired URLs', async () => {
    expect(() => normalizeObjectPath('../secret.txt')).toThrow(/Invalid storage object path/);
    expect(() => normalizeObjectPath('C:\\secret.txt')).toThrow(/Invalid storage object path/);

    const store = getObjectStore(env);
    const signed = new URL(
      await store.createSignedReadUrl('documents/example.pdf', { expiresMs: 60_000 })
    );
    signed.searchParams.set('path', 'documents/other.pdf');
    expect(() => verifyLocalReadUrl(Object.fromEntries(signed.searchParams), env)).toThrow(
      /signature/
    );

    const expired = new URL(
      await store.createSignedReadUrl('documents/example.pdf', { expiresMs: 1 })
    );
    expect(() =>
      verifyLocalReadUrl(Object.fromEntries(expired.searchParams), env, Date.now() + 10_000)
    ).toThrow(/expired/);
  });
});
