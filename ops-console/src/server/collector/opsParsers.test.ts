import { describe, expect, it } from 'vitest';
import { parseCronAndBackupState } from './opsParsers.js';

describe('cron and backup parser', () => {
  it('accepts only fixed cron markers and checks encrypted checksum artifacts', () => {
    const state = parseCronAndBackupState({
      cronLines: ['run-cron.sh job=nightly status=success', 'untrusted user input status=failure'],
      backupFiles: [{ name: 'nightly-20260823.enc', mtimeMs: Date.parse('2026-08-23T00:00:00Z'), size: 20, encrypted: true, checksumPresent: true }],
    }, new Date('2026-08-23T01:00:00Z'));
    expect(state.cron).toEqual([{ job: 'nightly', status: 'success', observedAt: '2026-08-23T01:00:00.000Z' }]);
    expect(state.backup).toMatchObject({ encrypted: true, checksumPresent: true, localOnly: true, ageHours: 1 });
    expect(state.level).toBe('warning');
    expect(state.errorCode).toBe('backup_local_only');
  });

  it('raises critical for stale or unverified backup state and disk thresholds', () => {
    const stale = parseCronAndBackupState({ cronLines: [], backupFiles: [{ name: 'db.enc', mtimeMs: Date.parse('2026-08-21T00:00:00Z'), size: 1, encrypted: true, checksumPresent: true }] }, new Date('2026-08-23T03:00:00Z'));
    expect(stale).toMatchObject({ level: 'critical', errorCode: 'backup_stale' });
    const disk = parseCronAndBackupState({ cronLines: [], backupFiles: [{ name: 'db.enc', mtimeMs: Date.parse('2026-08-23T00:00:00Z'), size: 1, encrypted: true, checksumPresent: true }], diskUsagePercent: 95 }, new Date('2026-08-23T01:00:00Z'));
    expect(disk.errorCode).toBe('backup_disk_critical');
  });
});
