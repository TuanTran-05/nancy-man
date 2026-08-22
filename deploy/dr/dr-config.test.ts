import { describe, expect, it } from 'vitest';

import { assertDistinctRecoveryTargets, readDrConfig } from './dr-config.js';

const validEnv = {
  OPS_DR_PRODUCTION_HOST_ID: 'postgres-primary-01',
  OPS_DR_BACKUP_HOST_ID: 'backup-01',
  OPS_DR_STANDBY_HOST_ID: 'postgres-standby-01',
  OPS_DR_ISOLATED_RESTORE_HOST_ID: 'restore-01',
  OPS_DR_STANZA: 'edutrack',
  OPS_DR_ARCHIVE_TIMEOUT_SECONDS: '60',
  OPS_DR_RETENTION_DAYS: '35'
};

describe('readDrConfig', () => {
  it('requires independent host identities and an archive timeout of at most 60 seconds', () => {
    const config = readDrConfig(validEnv);

    expect(config.archiveTimeoutSeconds).toBeLessThanOrEqual(60);
    expect(
      new Set([
        config.productionHostId,
        config.backupHostId,
        config.standbyHostId,
        config.isolatedRestoreHostId
      ]).size
    ).toBe(4);
    expect(config.rpoTargetSeconds).toBe(60);
    expect(config.rtoTargetSeconds).toBe(900);
  });

  it('rejects a recovery host that resolves to production', () => {
    expect(() =>
      readDrConfig({
        ...validEnv,
        OPS_DR_ISOLATED_RESTORE_HOST_ID: validEnv.OPS_DR_PRODUCTION_HOST_ID
      })
    ).toThrow(/must be distinct/i);
  });

  it('rejects archive timeout and retention values outside the recovery policy', () => {
    expect(() => readDrConfig({ ...validEnv, OPS_DR_ARCHIVE_TIMEOUT_SECONDS: '61' })).toThrow(
      /archive timeout/i
    );
    expect(() => readDrConfig({ ...validEnv, OPS_DR_RETENTION_DAYS: '34' })).toThrow(/retention/i);
  });

  it('defends again when host identities are passed to the explicit target assertion', () => {
    expect(() =>
      assertDistinctRecoveryTargets({
        productionHostId: 'postgres-primary-01',
        backupHostId: 'backup-01',
        standbyHostId: 'postgres-primary-01',
        isolatedRestoreHostId: 'restore-01'
      })
    ).toThrow(/must be distinct/i);
  });
});
