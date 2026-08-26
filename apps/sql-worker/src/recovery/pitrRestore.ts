import { posix as path } from 'node:path';

import { assertIsolatedTarget, type DatabaseIdentity } from './targetIdentity.js';

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

export type RecoveryTarget =
  | { type: 'time'; value: string; action: 'pause' }
  | { type: 'lsn'; value: string; action: 'pause' };

export type PitrRestorePlan = {
  recoveryId: string;
  dataDirectory: string;
  database: string;
  pgBackRestArguments: string[];
};

function hasTimestamp(input: {
  timestamp?: string;
  walLsn?: string;
}): input is { timestamp: string } {
  return typeof input.timestamp === 'string' && input.timestamp.length > 0;
}

function hasWalLsn(input: { timestamp?: string; walLsn?: string }): input is { walLsn: string } {
  return typeof input.walLsn === 'string' && input.walLsn.length > 0;
}

export function buildRecoveryTarget(input: {
  timestamp?: string;
  walLsn?: string;
}): RecoveryTarget {
  const timestampRequested = hasTimestamp(input);
  const walLsnRequested = hasWalLsn(input);

  if (timestampRequested === walLsnRequested) {
    throw new Error('Recovery requires exactly one timestamp or WAL LSN target');
  }

  if (timestampRequested) {
    const timestamp = input.timestamp;
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
      throw new Error('Recovery timestamp must be an ISO-8601 timestamp');
    }

    return { type: 'time', value: timestamp, action: 'pause' };
  }

  const walLsn = input.walLsn;
  if (!walLsn || !/^[0-9A-F]+\/[0-9A-F]+$/i.test(walLsn)) {
    throw new Error('Recovery WAL LSN is invalid');
  }

  return { type: 'lsn', value: walLsn, action: 'pause' };
}

export function buildPitrRestorePlan(input: {
  recoveryId: string;
  targetHostId: string;
  targetDatabase: string;
  pgDataRoot: string;
  target: { timestamp?: string; walLsn?: string };
}): PitrRestorePlan {
  if (!/^RCV_[A-Za-z0-9_-]{8,80}$/.test(input.recoveryId)) {
    throw new Error('Recovery ID is invalid');
  }

  if (!input.targetDatabase.startsWith('edutrack_recovery_')) {
    throw new Error('Recovery target database must start with edutrack_recovery_');
  }

  if (!path.isAbsolute(input.pgDataRoot) || path.normalize(input.pgDataRoot) !== input.pgDataRoot) {
    throw new Error('Recovery data root must be an absolute normalized path');
  }

  const target = buildRecoveryTarget(input.target);
  const dataDirectory = path.join(input.pgDataRoot, input.recoveryId);

  return {
    recoveryId: input.recoveryId,
    dataDirectory,
    database: input.targetDatabase,
    pgBackRestArguments: [
      '--stanza=edutrack',
      `--pg1-path=${dataDirectory}`,
      `--type=${target.type}`,
      `--target=${target.value}`,
      '--target-action=pause',
      'restore'
    ]
  };
}

export async function restoreToTarget(input: {
  production: DatabaseIdentity;
  target: DatabaseIdentity;
  allowedTargetHostIds: readonly string[];
  plan: PitrRestorePlan;
  requestedTarget: { timestamp?: string; walLsn?: string };
  executeRestore: (plan: PitrRestorePlan) => Promise<{ pausedAt: string; recoveredWalLsn: string }>;
  evidenceSha256: string;
}): Promise<RecoveryEvidence> {
  assertIsolatedTarget(input.production, input.target, input.allowedTargetHostIds);
  const result = await input.executeRestore(input.plan);

  return Object.freeze({
    recoveryId: input.plan.recoveryId as `RCV_${string}`,
    sourceSystemId: input.production.systemId,
    targetSystemId: input.target.systemId,
    targetHostId: input.target.hostId,
    targetDatabase: input.target.database,
    requestedTarget: input.requestedTarget,
    pausedAt: result.pausedAt,
    recoveredWalLsn: result.recoveredWalLsn,
    verificationStatus: 'pending',
    evidenceSha256: input.evidenceSha256
  });
}
