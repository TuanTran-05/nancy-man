import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { copyDatabaseMigrations } from './copyMigrations.mjs';

const paths = [];

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'edutrack-ops-migrations-'));
  paths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('copyDatabaseMigrations', () => {
  it('copies deploy-time SQL migration assets into the API runtime artifact', async () => {
    const source = await directory();
    const destination = await directory();
    await writeFile(join(source, '0001_ops_foundation.sql'), 'CREATE TABLE ops_users ();\n');

    await copyDatabaseMigrations({ sourceDirectory: source, destinationDirectory: destination });

    await expect(readFile(join(destination, '0001_ops_foundation.sql'), 'utf8')).resolves.toBe(
      'CREATE TABLE ops_users ();\n'
    );
    expect((await stat(destination)).mode & 0o777).toBe(0o755);
  });
});
