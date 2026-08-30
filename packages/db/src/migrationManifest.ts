import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type OpsMigration = {
  id: string;
  sql: string;
  checksum: string;
};

function readMigration(id: string, fileName: string): OpsMigration {
  const sqlBytes = readFileSync(new URL(`../migrations/${fileName}`, import.meta.url));
  return {
    id,
    sql: sqlBytes.toString('utf8'),
    checksum: createHash('sha256').update(sqlBytes).digest('hex')
  };
}

export const opsMigrationManifest: readonly OpsMigration[] = [
  readMigration('0001_ops_foundation', '0001_ops_foundation.sql'),
  readMigration('0002_error_operations', '0002_error_operations.sql'),
  readMigration('0003_ingest_processing_state', '0003_ingest_processing_state.sql'),
  readMigration('0004_error_source_extensions', '0004_error_source_extensions.sql'),
  readMigration('0005_error_issue_affected_users', '0005_error_issue_affected_users.sql'),
  readMigration('0006_release_publishers', '0006_release_publishers.sql'),
  readMigration('0007_ingest_nonces', '0007_ingest_nonces.sql'),
  readMigration('0008_ingest_rate_limits', '0008_ingest_rate_limits.sql'),
  readMigration('0009_alert_delivery_outbox', '0009_alert_delivery_outbox.sql'),
  readMigration('0010_ops_login_challenges', '0010_ops_login_challenges.sql'),
  readMigration('0011_ops_mfa_enrollment_tokens', '0011_ops_mfa_enrollment_tokens.sql'),
  readMigration('0012_sql_execution_audit', '0012_sql_execution_audit.sql'),
  readMigration('0013_sql_session_elevations', '0013_sql_session_elevations.sql')
];
