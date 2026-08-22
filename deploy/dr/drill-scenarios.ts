export const requiredScenarios = [
  'single_row_update',
  'mass_delete',
  'truncate_table',
  'drop_table',
  'primary_host_loss',
  'backup_host_unavailable',
  'wrong_target_rejected'
] as const;

export type DrillScenario = (typeof requiredScenarios)[number];

export type DrillEvidence = {
  scenario: DrillScenario;
  declaredAt: string;
  recoveryTarget: { timestamp: string; walLsn: string };
  lastRecoverableCommitAt: string;
  readyAt: string;
  measuredRpoSeconds: number;
  measuredRtoSeconds: number;
  sourceSystemId: string;
  targetSystemId: string;
  verificationPassed: boolean;
  operatorId: string;
  toolReleaseSha: string;
  evidenceSha256: string;
  signature: string;
};

export type UnsignedDrillEvidence = Omit<DrillEvidence, 'evidenceSha256' | 'signature'>;
