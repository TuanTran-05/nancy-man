import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSecretResolver } from './fileSecretResolver.js';

const directories: string[] = [];

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'edutrack-ops-secrets-'));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('FileSecretResolver', () => {
  it('reads a bounded secret from an allowlisted credential directory without exposing its path or bytes', async () => {
    const root = await directory();
    await writeFile(join(root, 'ingest-edutrack-api'), '  signing-secret\n', { mode: 0o600 });
    const resolver = new FileSecretResolver(root);

    await expect(resolver.resolve('ingest-edutrack-api')).resolves.toBe('signing-secret');
  });

  it('fails closed for traversal, symbolic links, insecure modes and oversized credential files', async () => {
    const root = await directory();
    const target = join(root, 'target');
    await writeFile(target, 'secret', { mode: 0o600 });
    await symlink(target, join(root, 'linked-secret'));
    await writeFile(join(root, 'insecure'), 'secret', { mode: 0o644 });
    await chmod(join(root, 'insecure'), 0o644);
    await writeFile(join(root, 'too-large'), 'x'.repeat(4_097), { mode: 0o600 });
    const resolver = new FileSecretResolver(root);

    await expect(resolver.resolve('../target')).resolves.toBeNull();
    await expect(resolver.resolve('linked-secret')).resolves.toBeNull();
    await expect(resolver.resolve('insecure')).resolves.toBeNull();
    await expect(resolver.resolve('too-large')).resolves.toBeNull();
    await expect(resolver.resolve('missing')).resolves.toBeNull();
  });
});
