import { isApprovedDrGate, type DrGateStatus } from '../../../../../deploy/dr/dr-status.schema.js';

export type DrHealth = {
  checkedAt: string;
  gate: DrGateStatus;
  archive: { healthy: boolean; lagSeconds: number; failedCountDelta: number };
  standby: { healthy: boolean; receiveLagBytes: number; replayLagSeconds: number };
  baseBackup: { healthy: boolean; newestCompletedAt: string; verified: boolean };
  auditReceiver: { healthy: boolean; lastAnchorAt: string };
  mutationAllowed: boolean;
  blockingCodes: string[];
};

export type DrHealthInput = Omit<DrHealth, 'mutationAllowed' | 'blockingCodes'>;

export function getDrHealth(input: DrHealthInput, now = new Date()): DrHealth {
  const blockingCodes: string[] = [];

  if (!input.gate.approved) {
    blockingCodes.push('DR_GATE_UNAPPROVED');
  } else if (!isApprovedDrGate(input.gate, now)) {
    blockingCodes.push('DR_GATE_EXPIRED');
  }

  if (
    !input.archive.healthy ||
    input.archive.lagSeconds > 60 ||
    input.archive.failedCountDelta > 0
  ) {
    blockingCodes.push('WAL_ARCHIVE_UNHEALTHY');
  }

  if (!input.standby.healthy || input.standby.replayLagSeconds > 60) {
    blockingCodes.push('STANDBY_UNHEALTHY');
  }

  if (!input.baseBackup.healthy || !input.baseBackup.verified) {
    blockingCodes.push('BASE_BACKUP_UNHEALTHY');
  }

  if (!input.auditReceiver.healthy) {
    blockingCodes.push('AUDIT_RECEIVER_UNHEALTHY');
  }

  return {
    ...input,
    mutationAllowed: blockingCodes.length === 0,
    blockingCodes
  };
}

export async function assertMutationRecoveryGate(health: DrHealth): Promise<void> {
  if (health.mutationAllowed) {
    return;
  }

  const code = health.blockingCodes.includes('DR_GATE_EXPIRED')
    ? 'DR_GATE_EXPIRED'
    : health.blockingCodes.join(',');
  throw new Error(code || 'DR_GATE_UNAPPROVED');
}
