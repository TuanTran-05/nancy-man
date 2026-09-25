import type { DatabaseTargetId } from '@edutrack-ops/contracts';

export const DATABASE_POLICY_VERSION = '2026-09-25';

export type DatabasePolicyApproval = {
  version: string;
  targets: Partial<Record<DatabaseTargetId, string>>;
};

export function assertPolicyApproved(input: {
  targetId: DatabaseTargetId;
  liveChecksum: string;
  approval?: DatabasePolicyApproval;
}): void {
  const error = Object.assign(new Error('DATABASE_SCHEMA_STALE'), {
    code: 'DATABASE_SCHEMA_STALE'
  });
  if (!input.approval || typeof input.approval !== 'object') {
    throw error;
  }

  if (input.approval.version !== DATABASE_POLICY_VERSION) {
    throw error;
  }

  const approvedChecksum = input.approval.targets?.[input.targetId];
  if (!approvedChecksum || approvedChecksum !== input.liveChecksum) {
    throw error;
  }
}
