export type RestorePointEvidence = {
  executionId: string;
  restorePointName: string;
  createdAt: string;
  walLsn: string;
  archivedThroughLsn: string;
  archiveVerified: boolean;
};

export type RecoveryEvidence = {
  recoveryId: `RCV_${string}`;
  sourceSystemId: string;
  targetSystemId: string;
  targetHostId: string;
  targetDatabase: string;
  requestedTarget: { timestamp?: string; walLsn?: string };
  pausedAt: string;
  recoveredWalLsn: string;
  verificationStatus: 'pending' | 'passed' | 'failed';
  evidenceSha256: string;
};
