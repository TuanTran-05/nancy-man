import { describe, expect, it } from 'vitest';

import { assertMutationRecoveryGate, getDrHealth } from './drHealth.js';

function healthyInput() {
  return {
    checkedAt: '2026-08-22T03:14:00.000Z',
    gate: {
      approved: true,
      approvedAt: '2026-08-22T03:14:00.000Z',
      evidenceSha256: 'a'.repeat(64),
      measuredRpoSeconds: 30,
      measuredRtoSeconds: 360,
      expiresAt: '2026-09-22T03:14:00.000Z'
    },
    archive: { healthy: true, lagSeconds: 30, failedCountDelta: 0 },
    standby: { healthy: true, receiveLagBytes: 0, replayLagSeconds: 10 },
    baseBackup: { healthy: true, newestCompletedAt: '2026-08-22T02:00:00.000Z', verified: true },
    auditReceiver: { healthy: true, lastAnchorAt: '2026-08-22T03:13:00.000Z' }
  };
}

describe('DR health mutation gate', () => {
  it('permits mutation only when every recovery dependency is healthy', async () => {
    const health = getDrHealth(healthyInput(), new Date('2026-08-22T03:14:00.000Z'));

    expect(health.mutationAllowed).toBe(true);
    expect(health.blockingCodes).toEqual([]);
    await expect(assertMutationRecoveryGate(health)).resolves.toBeUndefined();
  });

  it('rejects expired drill evidence with the precise gate code', async () => {
    const health = getDrHealth(
      {
        ...healthyInput(),
        gate: { ...healthyInput().gate, expiresAt: '2026-08-21T03:14:00.000Z' }
      },
      new Date('2026-08-22T03:14:00.000Z')
    );

    await expect(assertMutationRecoveryGate(health)).rejects.toThrow('DR_GATE_EXPIRED');
  });

  it.each([
    [
      'archive lag exceeds sixty seconds',
      { archive: { healthy: true, lagSeconds: 61, failedCountDelta: 0 } },
      'WAL_ARCHIVE_UNHEALTHY'
    ],
    [
      'the standby is unavailable',
      { standby: { healthy: false, receiveLagBytes: 0, replayLagSeconds: 0 } },
      'STANDBY_UNHEALTHY'
    ],
    [
      'the backup lacks verification',
      {
        baseBackup: {
          healthy: true,
          newestCompletedAt: '2026-08-22T02:00:00.000Z',
          verified: false
        }
      },
      'BASE_BACKUP_UNHEALTHY'
    ],
    [
      'the off-host audit receiver is unavailable',
      { auditReceiver: { healthy: false, lastAnchorAt: '2026-08-22T03:13:00.000Z' } },
      'AUDIT_RECEIVER_UNHEALTHY'
    ]
  ])('blocks mutation when %s', (_reason, patch, expectedCode) => {
    const health = getDrHealth(
      { ...healthyInput(), ...patch },
      new Date('2026-08-22T03:14:00.000Z')
    );

    expect(health.mutationAllowed).toBe(false);
    expect(health.blockingCodes).toContain(expectedCode);
  });
});
