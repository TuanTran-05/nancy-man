import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type OpsMigration = {
  id: string;
  sql: string;
  checksum: string;
};

type MigrationTrustRootEntry = {
  id: string;
  fileName: string;
  checksum: string;
};

export const opsMigrationTrustRoot: readonly MigrationTrustRootEntry[] = [
  {
    id: '0001_ops_foundation',
    fileName: '0001_ops_foundation.sql',
    checksum: '0e303858d2091d0f1375d2ee211062091919b8365b8e1a075173b959a780e942'
  },
  {
    id: '0002_error_operations',
    fileName: '0002_error_operations.sql',
    checksum: '1df63ed69d64e3b3449dcb1c404ffd6abae18d92a1178759aa73772c410a1619'
  },
  {
    id: '0003_ingest_processing_state',
    fileName: '0003_ingest_processing_state.sql',
    checksum: '10292c2e3be2d30395cfc76ff0cd55828e8d8d3b0074519f9ef9a1786d3cecb3'
  },
  {
    id: '0004_error_source_extensions',
    fileName: '0004_error_source_extensions.sql',
    checksum: '676198a75e43996ea2010b60368828bd533e46adb253cc4ad0dfa3b51f94ad40'
  },
  {
    id: '0005_error_issue_affected_users',
    fileName: '0005_error_issue_affected_users.sql',
    checksum: '3ab43ebc57fe064f6bd2c7c289bf16304ff9a5ac2485e1fc563902738c7c892a'
  },
  {
    id: '0006_release_publishers',
    fileName: '0006_release_publishers.sql',
    checksum: '66905b9dea2aefdac765ed45b09c8aae65919079f0dd194556e867f5cf23bcc6'
  },
  {
    id: '0007_ingest_nonces',
    fileName: '0007_ingest_nonces.sql',
    checksum: 'cf7ffd2a09ff6d72a084979eeef76173617a64a0628132be837b3a004702c829'
  },
  {
    id: '0008_ingest_rate_limits',
    fileName: '0008_ingest_rate_limits.sql',
    checksum: '91474dde1a011d14ed1ced29afa1c0a9187ae3b3182866f0589c41fbace9b346'
  },
  {
    id: '0009_alert_delivery_outbox',
    fileName: '0009_alert_delivery_outbox.sql',
    checksum: '5e517e7c2a1da9a930182d9715055c3e28fde0b0e0d485cb3c0f00ff2a1eebc8'
  },
  {
    id: '0010_ops_login_challenges',
    fileName: '0010_ops_login_challenges.sql',
    checksum: 'f200e35a60f5d885232df568e1a0ff29b018ae85bb41c57c00ea01bdd9326891'
  },
  {
    id: '0011_ops_mfa_enrollment_tokens',
    fileName: '0011_ops_mfa_enrollment_tokens.sql',
    checksum: '2de81af62f5aff331aab88456f6b19eee4d4fe66ef052ea20cfa7d27872a9629'
  },
  {
    id: '0012_sql_execution_audit',
    fileName: '0012_sql_execution_audit.sql',
    checksum: 'aaa2a9a6e4d7776ccb8099a78d687af748288a29680b79c4c97184ccf70f1f1d'
  },
  {
    id: '0013_sql_session_elevations',
    fileName: '0013_sql_session_elevations.sql',
    checksum: 'ad11197d1d48df1e4df5f7cc719fc57cc7e3827d60fd799ff282b242cfba7a5a'
  },
  {
    id: '0014_ops_account_administration',
    fileName: '0014_ops_account_administration.sql',
    checksum: '3ca78b98b51979767355df5d148222c28b6e9ba3fa75aeb7ead2574c87617cca'
  }
];

export function loadOpsMigrationManifest(migrationDirectory: string): readonly OpsMigration[] {
  const expectedFileNames = opsMigrationTrustRoot.map((migration) => migration.fileName);
  const actualFileNames = readdirSync(migrationDirectory).sort();
  if (actualFileNames.length !== expectedFileNames.length) {
    throw new Error('OPS_MIGRATION_DIRECTORY_MISMATCH');
  }
  for (const [index, fileName] of expectedFileNames.entries()) {
    if (actualFileNames[index] !== fileName) {
      throw new Error('OPS_MIGRATION_DIRECTORY_MISMATCH');
    }
  }

  return opsMigrationTrustRoot.map((migration) => {
    const sqlBytes = readFileSync(join(migrationDirectory, migration.fileName));
    const checksum = createHash('sha256').update(sqlBytes).digest('hex');
    if (checksum !== migration.checksum) {
      throw new Error(`OPS_MIGRATION_CHECKSUM_MISMATCH:${migration.id}`);
    }
    return { id: migration.id, sql: sqlBytes.toString('utf8'), checksum };
  });
}

export const opsMigrationManifest = loadOpsMigrationManifest(
  fileURLToPath(new URL('../migrations/', import.meta.url))
);
