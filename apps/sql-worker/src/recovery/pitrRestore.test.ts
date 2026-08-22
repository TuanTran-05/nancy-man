import { describe, expect, it } from 'vitest';

import { buildPitrRestorePlan, buildRecoveryTarget } from './pitrRestore.js';

describe('PITR recovery planning', () => {
  it('builds a paused time-based recovery target', () => {
    expect(buildRecoveryTarget({ timestamp: '2026-08-22T03:14:00Z' })).toEqual({
      type: 'time',
      value: '2026-08-22T03:14:00Z',
      action: 'pause'
    });
  });

  it('requires exactly one timestamp or WAL LSN target', () => {
    expect(() => buildRecoveryTarget({})).toThrow(/exactly one/i);
    expect(() =>
      buildRecoveryTarget({ timestamp: '2026-08-22T03:14:00Z', walLsn: '0/16B6C50' })
    ).toThrow(/exactly one/i);
  });

  it('only plans a private restore with a unique recovery directory', () => {
    expect(
      buildPitrRestorePlan({
        recoveryId: 'RCV_01K3EXAMPLE',
        targetHostId: 'restore-01',
        targetDatabase: 'edutrack_recovery_01k3example',
        pgDataRoot: '/var/lib/postgresql/16/recovery',
        target: { walLsn: '0/16B6C50' }
      })
    ).toEqual({
      recoveryId: 'RCV_01K3EXAMPLE',
      dataDirectory: '/var/lib/postgresql/16/recovery/RCV_01K3EXAMPLE',
      database: 'edutrack_recovery_01k3example',
      pgBackRestArguments: [
        '--stanza=edutrack',
        '--pg1-path=/var/lib/postgresql/16/recovery/RCV_01K3EXAMPLE',
        '--type=lsn',
        '--target=0/16B6C50',
        '--target-action=pause',
        'restore'
      ]
    });
  });
});
