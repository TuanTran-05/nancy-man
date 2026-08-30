import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCronAndBackupState } from './opsParsers.js';

describe('cron and backup parser', () => {
  it('accepts only fixed cron markers and checks encrypted checksum artifacts', () => {
    const state = parseCronAndBackupState(
      {
        cronLines: [
          'run-cron.sh job=nightly status=success',
          'untrusted user input status=failure'
        ],
        backupFiles: [
          {
            name: 'nightly-20260823.enc',
            mtimeMs: Date.parse('2026-08-23T00:00:00Z'),
            size: 20,
            encrypted: true,
            checksumPresent: true
          }
        ]
      },
      new Date('2026-08-23T01:00:00Z')
    );
    expect(state.cron).toEqual([
      { job: 'nightly', status: 'success', observedAt: '2026-08-23T01:00:00.000Z' }
    ]);
    expect(state.backup).toMatchObject({
      encrypted: true,
      checksumPresent: true,
      localOnly: true,
      ageHours: 1
    });
    expect(state.backupLevel).toBe('warning');
    expect(state.backupErrorCode).toBe('backup_local_only');
  });

  it('raises critical for stale or unverified backup state and disk thresholds', () => {
    const stale = parseCronAndBackupState(
      {
        cronLines: [],
        backupFiles: [
          {
            name: 'db.enc',
            mtimeMs: Date.parse('2026-08-21T00:00:00Z'),
            size: 1,
            encrypted: true,
            checksumPresent: true
          }
        ]
      },
      new Date('2026-08-23T03:00:00Z')
    );
    expect(stale).toMatchObject({ backupLevel: 'critical', backupErrorCode: 'backup_stale' });
    const disk = parseCronAndBackupState(
      {
        cronLines: [],
        backupFiles: [
          {
            name: 'db.enc',
            mtimeMs: Date.parse('2026-08-23T00:00:00Z'),
            size: 1,
            encrypted: true,
            checksumPresent: true
          }
        ],
        diskUsagePercent: 95
      },
      new Date('2026-08-23T01:00:00Z')
    );
    expect(disk.backupErrorCode).toBe('backup_disk_critical');
  });

  it('keeps backup local-only warning separate from a healthy cron monitor', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-backup-'));
    const postgresDirectory = join(directory, 'postgres');
    mkdirSync(postgresDirectory);
    writeFileSync(join(postgresDirectory, 'edutrack-20260823.dump.age'), 'encrypted');
    writeFileSync(join(postgresDirectory, 'edutrack-20260823.dump.age.sha256'), 'checksum');
    try {
      const state = parseCronAndBackupState(
        { cronLines: [], backupDir: directory },
        new Date('2026-08-23T01:00:00Z')
      );
      expect(state).toMatchObject({
        cronLevel: 'healthy',
        cronErrorCode: null,
        backupLevel: 'warning',
        backupErrorCode: 'backup_local_only'
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports cron failure independently of a valid backup warning', () => {
    const state = parseCronAndBackupState(
      {
        cronLines: ['ops-cron job=nightly status=failure'],
        backupFiles: [
          {
            name: 'db.age',
            mtimeMs: Date.parse('2026-08-23T00:00:00Z'),
            size: 1,
            encrypted: true,
            checksumPresent: true
          }
        ]
      },
      new Date('2026-08-23T01:00:00Z')
    );
    expect(state).toMatchObject({
      cronLevel: 'critical',
      cronErrorCode: 'cron_failure',
      backupLevel: 'warning',
      backupErrorCode: 'backup_local_only'
    });
  });
});
