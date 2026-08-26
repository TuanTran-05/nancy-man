import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const restoreScript = fileURLToPath(new URL('./restore-isolated.sh', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('isolated restore script', () => {
  it('rejects production before it can create a recovery directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutrack-pitr-'));
    temporaryDirectories.push(directory);

    try {
      execFileSync(
        restoreScript,
        [
          '--recovery-id',
          'RCV_01K3EXAMPLE',
          '--target-host-id',
          'postgres-primary-01',
          '--target-database',
          'edutrack_recovery_01k3example',
          '--target-time',
          '2026-08-22T03:14:00Z'
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            OPS_DR_PRODUCTION_HOST_ID: 'postgres-primary-01',
            OPS_DR_ISOLATED_RESTORE_HOST_ID: 'restore-01',
            RECOVERY_PGDATA_ROOT: directory
          }
        }
      );
      throw new Error('restore-isolated.sh should have rejected production');
    } catch (error) {
      const commandError = error as { status?: number; stderr?: string };
      expect(commandError.status).toBe(2);
      expect(commandError.stderr).toMatch(/production/i);
    }
  });

  it('uses paused recovery and verifies the release in an isolated database', async () => {
    const [restore, verify] = await Promise.all([
      readFile(restoreScript, 'utf8'),
      readFile(new URL('./verify-restored-database.sh', import.meta.url), 'utf8')
    ]);

    expect(restore).toContain('--target-action=pause');
    expect(restore).toContain('edutrack_recovery_');
    expect(restore).toContain('OPS_DR_ISOLATED_RESTORE_HOST_ID');
    expect(verify).toContain('db/verify-schema.sql');
    expect(verify).toContain('db/verify-data.sql');
    expect(verify).toContain('restore verification reported FAIL');
  });
});
