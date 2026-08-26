export const recoveryEvidenceColumns = [
  'execution_id',
  'restore_point_name',
  'created_at',
  'wal_lsn',
  'archived_through_lsn',
  'archive_verified'
] as const;

export type RecoveryEvidenceColumn = (typeof recoveryEvidenceColumns)[number];
