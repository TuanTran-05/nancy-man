import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  loadOpsMigrationManifest,
  opsMigrationManifest,
  opsMigrationTrustRoot
} from './migrationManifest.js';

const expectedTrustRoot = [
  [
    '0001_ops_foundation',
    '0001_ops_foundation.sql',
    '0e303858d2091d0f1375d2ee211062091919b8365b8e1a075173b959a780e942'
  ],
  [
    '0002_error_operations',
    '0002_error_operations.sql',
    '1df63ed69d64e3b3449dcb1c404ffd6abae18d92a1178759aa73772c410a1619'
  ],
  [
    '0003_ingest_processing_state',
    '0003_ingest_processing_state.sql',
    '10292c2e3be2d30395cfc76ff0cd55828e8d8d3b0074519f9ef9a1786d3cecb3'
  ],
  [
    '0004_error_source_extensions',
    '0004_error_source_extensions.sql',
    '676198a75e43996ea2010b60368828bd533e46adb253cc4ad0dfa3b51f94ad40'
  ],
  [
    '0005_error_issue_affected_users',
    '0005_error_issue_affected_users.sql',
    '3ab43ebc57fe064f6bd2c7c289bf16304ff9a5ac2485e1fc563902738c7c892a'
  ],
  [
    '0006_release_publishers',
    '0006_release_publishers.sql',
    '66905b9dea2aefdac765ed45b09c8aae65919079f0dd194556e867f5cf23bcc6'
  ],
  [
    '0007_ingest_nonces',
    '0007_ingest_nonces.sql',
    'cf7ffd2a09ff6d72a084979eeef76173617a64a0628132be837b3a004702c829'
  ],
  [
    '0008_ingest_rate_limits',
    '0008_ingest_rate_limits.sql',
    '91474dde1a011d14ed1ced29afa1c0a9187ae3b3182866f0589c41fbace9b346'
  ],
  [
    '0009_alert_delivery_outbox',
    '0009_alert_delivery_outbox.sql',
    '5e517e7c2a1da9a930182d9715055c3e28fde0b0e0d485cb3c0f00ff2a1eebc8'
  ],
  [
    '0010_ops_login_challenges',
    '0010_ops_login_challenges.sql',
    'f200e35a60f5d885232df568e1a0ff29b018ae85bb41c57c00ea01bdd9326891'
  ],
  [
    '0011_ops_mfa_enrollment_tokens',
    '0011_ops_mfa_enrollment_tokens.sql',
    '2de81af62f5aff331aab88456f6b19eee4d4fe66ef052ea20cfa7d27872a9629'
  ],
  [
    '0012_sql_execution_audit',
    '0012_sql_execution_audit.sql',
    'aaa2a9a6e4d7776ccb8099a78d687af748288a29680b79c4c97184ccf70f1f1d'
  ],
  [
    '0013_sql_session_elevations',
    '0013_sql_session_elevations.sql',
    'ad11197d1d48df1e4df5f7cc719fc57cc7e3827d60fd799ff282b242cfba7a5a'
  ],
  [
    '0014_ops_account_administration',
    '0014_ops_account_administration.sql',
    '3ca78b98b51979767355df5d148222c28b6e9ba3fa75aeb7ead2574c87617cca'
  ],
  [
    '0015_ops_secret_elevations',
    '0015_ops_secret_elevations.sql',
    'e6619cd336f43265cce3dca9b846fae2f03e5700f8f50581afe2eb68862dc020'
  ],
  [
    '0016_ops_secret_elevation_reuse',
    '0016_ops_secret_elevation_reuse.sql',
    '992c741ba83a9fa03028c475494c5c1b4e514ed945c939dcb8d94d1bf3bce98c'
  ],
  [
    '0017_ops_config_changes',
    '0017_ops_config_changes.sql',
    '494a2d02909e3c6b7bdf401d585f36057285e2ebaf4843893ef8faf0d270bcd9'
  ]
] as const;

describe('Ops migration manifest', () => {
  it('attests every canonical SQL byte sequence against the pinned trust root', () => {
    expect(opsMigrationTrustRoot).toEqual(
      expectedTrustRoot.map(([id, fileName, checksum]) => ({ id, fileName, checksum }))
    );
    expect(opsMigrationManifest.map((migration) => migration.checksum)).toEqual(
      opsMigrationManifest.map((migration) =>
        createHash('sha256').update(migration.sql, 'utf8').digest('hex')
      )
    );
  });

  it('rejects a non-0001 fixture byte mutation instead of blessing a new digest', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'ops-migration-manifest-'));
    for (const [, fileName] of expectedTrustRoot) {
      copyFileSync(
        new URL(`../migrations/${fileName}`, import.meta.url),
        join(fixtureDirectory, fileName)
      );
    }
    writeFileSync(join(fixtureDirectory, '0002_error_operations.sql'), 'tampered\n');

    expect(() => loadOpsMigrationManifest(fixtureDirectory)).toThrow(
      'OPS_MIGRATION_CHECKSUM_MISMATCH:0002_error_operations'
    );
  });

  it('rejects a migration directory whose filenames differ from the trust root', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'ops-migration-manifest-'));
    mkdirSync(fixtureDirectory, { recursive: true });
    for (const [, fileName] of expectedTrustRoot) {
      copyFileSync(
        new URL(`../migrations/${fileName}`, import.meta.url),
        join(fixtureDirectory, fileName)
      );
    }
    writeFileSync(join(fixtureDirectory, '0014_unregistered.sql'), 'SELECT 1;\n');

    expect(() => loadOpsMigrationManifest(fixtureDirectory)).toThrow(
      'OPS_MIGRATION_DIRECTORY_MISMATCH'
    );
  });
});
