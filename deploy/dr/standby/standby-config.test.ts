import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const bootstrapScript = fileURLToPath(new URL('./bootstrap-standby.sh', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function validEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), 'edutrack-standby-test-'));
  temporaryDirectories.push(directory);
  const dataDirectory = join(directory, 'postgres-data');
  const tlsCaFile = join(directory, 'primary-ca.crt');

  await mkdir(dataDirectory);
  await writeFile(tlsCaFile, 'test CA only\n', 'utf8');

  return {
    OPS_DR_PRODUCTION_HOST_ID: 'postgres-primary-01',
    OPS_DR_STANDBY_HOST_ID: 'postgres-standby-01',
    OPS_DR_TLS_CA_FILE: tlsCaFile,
    OPS_DR_REPLICATION_DSN:
      'postgresql://edutrack_replication@postgres-primary-01:5432/postgres?sslmode=verify-full',
    PGDATA: dataDirectory
  };
}

function expectRejected(environment: NodeJS.ProcessEnv, hostId: string, message: RegExp) {
  try {
    execFileSync(bootstrapScript, ['--host-id', hostId], {
      encoding: 'utf8',
      env: { ...process.env, ...environment }
    });
    throw new Error('bootstrap-standby.sh should have rejected unsafe input');
  } catch (error) {
    const commandError = error as { status?: number; stderr?: string };
    expect(commandError.status).toBe(2);
    expect(commandError.stderr).toMatch(message);
  }
}

describe('warm standby bootstrap safety', () => {
  it('rejects the production host ID before it can become a standby target', async () => {
    const environment = await validEnvironment();

    expectRejected(environment, environment.OPS_DR_PRODUCTION_HOST_ID, /production host/i);
  });

  it('rejects a non-empty PostgreSQL data directory', async () => {
    const environment = await validEnvironment();
    await writeFile(join(environment.PGDATA, 'existing-file'), 'must not be overwritten', 'utf8');

    expectRejected(environment, environment.OPS_DR_STANDBY_HOST_ID, /data directory.*empty/i);
  });

  it('rejects a missing TLS CA before restoring any data', async () => {
    const environment = await validEnvironment();
    environment.OPS_DR_TLS_CA_FILE = join(environment.PGDATA, 'missing-ca.crt');

    expectRejected(environment, environment.OPS_DR_STANDBY_HOST_ID, /TLS CA/i);
  });

  it('rejects a replication URL that points back to the standby host', async () => {
    const environment = await validEnvironment();
    environment.OPS_DR_REPLICATION_DSN =
      'postgresql://edutrack_replication@postgres-standby-01:5432/postgres?sslmode=verify-full';

    expectRejected(environment, environment.OPS_DR_STANDBY_HOST_ID, /resolves to the standby/i);
  });
});
