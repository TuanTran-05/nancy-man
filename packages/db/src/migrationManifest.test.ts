import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { opsMigrationManifest } from './migrationManifest.js';

describe('Ops migration manifest', () => {
  it('attests every canonical SQL byte sequence with a SHA-256 checksum', () => {
    expect(opsMigrationManifest.map((migration) => migration.id)).toEqual([
      '0001_ops_foundation',
      '0002_error_operations',
      '0003_ingest_processing_state',
      '0004_error_source_extensions',
      '0005_error_issue_affected_users',
      '0006_release_publishers',
      '0007_ingest_nonces',
      '0008_ingest_rate_limits',
      '0009_alert_delivery_outbox',
      '0010_ops_login_challenges',
      '0011_ops_mfa_enrollment_tokens',
      '0012_sql_execution_audit',
      '0013_sql_session_elevations'
    ]);
    expect(opsMigrationManifest.map((migration) => migration.checksum)).toEqual(
      opsMigrationManifest.map((migration) =>
        createHash('sha256').update(migration.sql, 'utf8').digest('hex')
      )
    );
    expect(opsMigrationManifest[0]).toMatchObject({
      checksum: '0e303858d2091d0f1375d2ee211062091919b8365b8e1a075173b959a780e942'
    });
  });
});
