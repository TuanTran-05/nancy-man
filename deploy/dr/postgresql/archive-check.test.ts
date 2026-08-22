import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const fragmentPath = new URL('./primary.fragment.conf', import.meta.url);
const checkerPath = new URL('./archive-check.sh', import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function createArchiveCheckHarness(lastArchivedAt: string) {
  const directory = await mkdtemp(join(tmpdir(), 'edutrack-wal-check-'));
  temporaryDirectories.push(directory);

  const fakePsql = join(directory, 'psql');
  const fakePgBackRest = join(directory, 'pgbackrest');
  const responsePath = join(directory, 'archive.json');

  await writeFile(fakePsql, '#!/usr/bin/env sh\ncat "$ARCHIVE_CHECK_PSQL_JSON"\n', 'utf8');
  await writeFile(fakePgBackRest, '#!/usr/bin/env sh\nexit 0\n', 'utf8');
  await chmod(fakePsql, 0o755);
  await chmod(fakePgBackRest, 0o755);
  await writeFile(
    responsePath,
    JSON.stringify({
      currentWalLsn: '0/1A2B3C4D',
      archivedCount: 18,
      failedCount: 0,
      lastArchivedAt,
      lastFailedAt: null
    }),
    'utf8'
  );

  return {
    directory,
    environment: {
      ...process.env,
      ARCHIVE_CHECK_PSQL_JSON: responsePath,
      ARCHIVE_CHECK_STATE_FILE: join(directory, 'state.json'),
      OPS_DR_ARCHIVE_TIMEOUT_SECONDS: '60',
      PGBACKREST_BIN: fakePgBackRest,
      PSQL_BIN: fakePsql
    }
  };
}

describe('continuous WAL archive monitoring', () => {
  it('uses the exact PostgreSQL settings required for replica-safe one-minute archiving', async () => {
    const fragment = await readFile(fragmentPath, 'utf8');

    expect(fragment).toContain('wal_level = replica');
    expect(fragment).toContain('archive_mode = on');
    expect(fragment).toContain("archive_timeout = '60s'");
    expect(fragment).toContain("archive_command = 'pgbackrest --stanza=edutrack archive-push %p'");
    expect(fragment).toContain('max_wal_senders = 10');
    expect(fragment).toContain("wal_keep_size = '2048MB'");
  });

  it('returns machine-readable healthy archive status', async () => {
    const harness = await createArchiveCheckHarness(new Date().toISOString());

    const output = execFileSync(fileURLToPath(checkerPath), ['--json'], {
      encoding: 'utf8',
      env: harness.environment
    });

    expect(JSON.parse(output)).toMatchObject({
      status: 'ok',
      code: null,
      lagSeconds: expect.any(Number),
      failedCountDelta: 0,
      currentWalLsn: '0/1A2B3C4D'
    });
  });

  it('rejects a newest WAL that is older than 60 seconds with wal_archive_lag', async () => {
    const harness = await createArchiveCheckHarness(new Date(Date.now() - 61_000).toISOString());

    try {
      execFileSync(fileURLToPath(checkerPath), ['--json'], {
        encoding: 'utf8',
        env: harness.environment
      });
      throw new Error('archive-check.sh should have failed');
    } catch (error) {
      const commandError = error as { status?: number; stdout?: string };
      expect(commandError.status).toBe(2);
      expect(JSON.parse(commandError.stdout ?? '')).toMatchObject({
        status: 'degraded',
        code: 'wal_archive_lag',
        lagSeconds: expect.any(Number)
      });
    }
  });
});
