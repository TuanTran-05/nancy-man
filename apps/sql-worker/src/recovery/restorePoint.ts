export type RestorePointEvidence = {
  executionId: string;
  restorePointName: string;
  createdAt: string;
  walLsn: string;
  archivedThroughLsn: string;
  archiveVerified: boolean;
};

export type RestorePointDatabase = {
  queryOne: <T>(sql: string, parameters: readonly unknown[]) => Promise<T>;
  execute: (sql: string) => Promise<void>;
};

export type ArchiveProbe = {
  latestArchivedLsn: () => Promise<string>;
};

function parseWalLsn(walLsn: string): bigint {
  const match = /^([0-9A-F]+)\/([0-9A-F]+)$/i.exec(walLsn);
  if (!match) {
    throw new Error('WAL LSN is invalid');
  }

  return (BigInt(`0x${match[1]}`) << 32n) + BigInt(`0x${match[2]}`);
}

export function createRestorePointName(executionId: string): string {
  const normalized = executionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const name = `ops_${normalized}`.slice(0, 59);

  if (!/^ops_[a-z0-9_]{1,55}$/.test(name)) {
    throw new Error('Execution ID cannot create a safe restore point name');
  }

  return name;
}

export async function createRestorePoint(input: {
  executionId: string;
  database: RestorePointDatabase;
  archiveProbe: ArchiveProbe;
  maxArchivePolls: number;
  now?: () => Date;
  waitForNextPoll?: () => Promise<void>;
}): Promise<RestorePointEvidence> {
  if (
    !Number.isInteger(input.maxArchivePolls) ||
    input.maxArchivePolls < 1 ||
    input.maxArchivePolls > 600
  ) {
    throw new Error('maxArchivePolls must be an integer between 1 and 600');
  }

  const restorePointName = createRestorePointName(input.executionId);
  const now = input.now ?? (() => new Date());
  const waitForNextPoll =
    input.waitForNextPoll ?? (() => new Promise((resolve) => setTimeout(resolve, 1_000)));
  const createdAt = now().toISOString();
  const { restoreLsn } = await input.database.queryOne<{ restoreLsn: string }>(
    'SELECT pg_create_restore_point($1)::text AS "restoreLsn"',
    [restorePointName]
  );

  parseWalLsn(restoreLsn);
  await input.database.execute('SELECT pg_switch_wal()');
  const { walLsn } = await input.database.queryOne<{ walLsn: string }>(
    'SELECT pg_current_wal_lsn()::text AS "walLsn"',
    []
  );
  parseWalLsn(walLsn);

  for (let attempt = 0; attempt < input.maxArchivePolls; attempt += 1) {
    const archivedThroughLsn = await input.archiveProbe.latestArchivedLsn();
    if (parseWalLsn(archivedThroughLsn) >= parseWalLsn(restoreLsn)) {
      return Object.freeze({
        executionId: input.executionId,
        restorePointName,
        createdAt,
        walLsn,
        archivedThroughLsn,
        archiveVerified: true
      });
    }

    if (attempt + 1 < input.maxArchivePolls) {
      await waitForNextPoll();
    }
  }

  throw new Error(`Archived WAL did not reach restore point ${restorePointName}`);
}
