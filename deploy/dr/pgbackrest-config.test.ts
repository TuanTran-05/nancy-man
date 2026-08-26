import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const paths = {
  backupTemplate: new URL('./pgbackrest/backup-host.conf.template', import.meta.url),
  primaryTemplate: new URL('./pgbackrest/primary.conf.template', import.meta.url),
  installer: new URL('./install-backup-host.sh', import.meta.url),
  verifier: new URL('./verify-backup-host.sh', import.meta.url)
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('pgBackRest configuration', () => {
  it('defines an encrypted 35-day repository without committing sensitive configuration', async () => {
    const [backupTemplate, primaryTemplate] = await Promise.all([
      readFile(paths.backupTemplate, 'utf8'),
      readFile(paths.primaryTemplate, 'utf8')
    ]);

    for (const template of [backupTemplate, primaryTemplate]) {
      expect(template).toContain('[global]');
      expect(template).toContain('repo1-retention-full=5');
      expect(template).toContain('repo1-retention-diff=35');
      expect(template).toContain('repo1-cipher-type=aes-256-cbc');
      expect(template).toContain('start-fast=y');
      expect(template).toContain('process-max=2');
      expect(template).toMatch(/\[edutrack\][\s\S]*pg1-path=\/var\/lib\/postgresql\/16\/main/);
      expect(template).not.toMatch(
        /(?:password|private[ _-]?key|postgres(?:ql)?:\/\/|repo1-host=\*)/i
      );
      expect(template).not.toMatch(/repo1-cipher-pass\s*=/i);
    }
  });

  it('keeps host provisioning dependent on an explicit host identifier and credential file', async () => {
    const installer = await readFile(paths.installer, 'utf8');

    expect(installer).toContain('--host-id');
    expect(installer).toMatch(/(?:EUID|id -u).*0/);
    expect(installer).toContain('OPS_DR_BACKUP_HOST_ID');
    expect(installer).toContain('OPS_DR_PGBACKREST_CREDENTIAL_FILE');
    expect(installer).toContain('stanza-create');
    expect(installer).toContain('check');
    expect(installer).not.toMatch(/echo .*PGBACKREST_REPO1_CIPHER_PASS/i);
  });

  it('emits only bounded backup health fields without disclosing a supplied secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutrack-pgbackrest-test-'));
    temporaryDirectories.push(directory);

    const fakePgBackRest = join(directory, 'pgbackrest');
    const infoPath = join(directory, 'info.json');
    const repositoryPath = join(directory, 'repo');

    await writeFile(fakePgBackRest, '#!/usr/bin/env sh\ncat "$PGBACKREST_INFO_JSON"\n', 'utf8');
    await chmod(fakePgBackRest, 0o755);
    await writeFile(
      infoPath,
      JSON.stringify([
        {
          name: 'edutrack',
          status: { code: 0, message: 'ok' },
          backup: [
            {
              type: 'full',
              timestamp: { start: 1_787_356_800, stop: 1_787_356_920 }
            }
          ]
        }
      ]),
      'utf8'
    );

    const output = execFileSync(fileURLToPath(paths.verifier), ['--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OPS_DR_BACKUP_HOST_ID: 'backup-01',
        PGBACKREST_BIN: fakePgBackRest,
        PGBACKREST_INFO_JSON: infoPath,
        PGBACKREST_REPOSITORY_PATH: repositoryPath,
        PGBACKREST_REPO1_CIPHER_PASS: 'must-not-be-disclosed'
      }
    });

    expect(JSON.parse(output)).toEqual({
      hostId: 'backup-01',
      stanza: 'edutrack',
      status: 'ok',
      latestFullAt: '2026-08-22T00:02:00.000Z',
      latestWalAt: null,
      repositoryBytes: 0
    });
    expect(output).not.toContain('must-not-be-disclosed');
  });
});
