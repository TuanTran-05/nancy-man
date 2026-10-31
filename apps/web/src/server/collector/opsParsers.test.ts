import { mkdirSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createBackupDiskSustainState,
  parseCronAndBackupState,
  type BackupDiskSustainState
} from './opsParsers.js';
import { evaluateMonitor } from './statusMachine.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readSync: vi.fn(actual.readSync) };
});

const backupFile = (name = 'db.age') => ({
  name,
  mtimeMs: Date.parse('2026-08-23T00:00:00Z'),
  size: 1,
  encrypted: true,
  checksumPresent: true
});

const offsiteLine = (timestamp: string, path: string) =>
  `${timestamp} encrypted PostgreSQL backup verified locally and offsite: ${path}`;

function sustainedDiskState(now: string, percent: number): BackupDiskSustainState {
  const nowMs = Date.parse(now);
  const state = createBackupDiskSustainState();
  const run = {
    overSinceMs: nowMs - 30 * 60_000,
    lastObservedAtMs: nowMs - 15_000
  };
  if (percent > 85) state.warning = { ...run };
  if (percent > 92) state.critical = { ...run };
  return state;
}

function withDirectory<T>(callback: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'ops-backup-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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
      offsiteVerifiedAt: null,
      ageHours: 1
    });
    expect(state.backupLevel).toBe('warning');
    expect(state.backupErrorCode).toBe('backup_local_only');
  });

  it('raises critical for stale or unverified backup state and disk thresholds', () => {
    const stale = parseCronAndBackupState(
      {
        cronLines: [],
        backupDiskSustain: sustainedDiskState('2026-08-23T03:00:00Z', 95),
        diskUsagePercent: 95,
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
        diskUsagePercent: 95,
        backupDiskSustain: sustainedDiskState('2026-08-23T01:00:00Z', 95)
      },
      new Date('2026-08-23T01:00:00Z')
    );
    expect(disk).toMatchObject({
      backupLevel: 'critical',
      backupErrorCode: 'backup_disk_critical'
    });

    const unverified = parseCronAndBackupState(
      {
        cronLines: [],
        backupFiles: [{ ...backupFile('db.age'), checksumPresent: false }],
        diskUsagePercent: 95,
        backupDiskSustain: sustainedDiskState('2026-08-23T01:00:00Z', 95)
      },
      new Date('2026-08-23T01:00:00Z')
    );
    expect(unverified).toMatchObject({
      backupLevel: 'critical',
      backupErrorCode: 'backup_unverified'
    });
  });

  it('uses strict 85% and 92% disk thresholds after 30 minutes of sustained observations', () => {
    withDirectory((directory) => {
      const logPath = join(directory, 'backup.log');
      writeFileSync(logPath, `${offsiteLine('2026-08-23T00:30:00Z', '/srv/backups/db.age')}\n`);
      const now = new Date('2026-08-23T01:00:00Z');
      const state = (diskUsagePercent: number) =>
        parseCronAndBackupState(
          {
            cronLines: [],
            backupFiles: [backupFile()],
            diskUsagePercent,
            backupOffsiteLogPath: logPath,
            backupDiskSustain: sustainedDiskState(now.toISOString(), diskUsagePercent)
          },
          now
        );

      expect(state(84.9)).toMatchObject({ backupLevel: 'healthy', backupErrorCode: null });
      expect(state(86)).toMatchObject({
        backupLevel: 'warning',
        backupErrorCode: 'backup_disk_warning'
      });
      expect(state(93)).toMatchObject({
        backupLevel: 'critical',
        backupErrorCode: 'backup_disk_critical'
      });
    });
  });

  it('resets both disk sustain runs after a missing reading or a gap over 60 seconds', () => {
    const backupDiskSustain = createBackupDiskSustainState();
    const input = {
      cronLines: [],
      backupFiles: [backupFile()],
      backupDiskSustain,
      diskUsagePercent: 93
    };
    parseCronAndBackupState(input, new Date('2026-08-23T01:00:00Z'));
    parseCronAndBackupState(input, new Date('2026-08-23T01:01:01Z'));
    expect(backupDiskSustain.warning.overSinceMs).toBe(Date.parse('2026-08-23T01:01:01Z'));
    expect(backupDiskSustain.critical.overSinceMs).toBe(Date.parse('2026-08-23T01:01:01Z'));

    parseCronAndBackupState({ ...input, diskUsagePercent: null }, new Date('2026-08-23T01:01:16Z'));
    expect(backupDiskSustain.warning).toEqual({ overSinceMs: null, lastObservedAtMs: null });
    expect(backupDiskSustain.critical).toEqual({ overSinceMs: null, lastObservedAtMs: null });
  });

  it('does not alert for a five-minute disk spike and recovers after the disk clears', () => {
    withDirectory((directory) => {
      const logPath = join(directory, 'backup.log');
      writeFileSync(logPath, `${offsiteLine('2026-08-23T00:30:00Z', '/srv/backups/db.age')}\n`);
      const base = {
        cronLines: [],
        backupFiles: [backupFile()],
        backupOffsiteLogPath: logPath
      };
      const spikeSustain = createBackupDiskSustainState();
      let spike = parseCronAndBackupState(
        { ...base, diskUsagePercent: 93, backupDiskSustain: spikeSustain },
        new Date('2026-08-23T00:55:00Z')
      );
      for (
        let timestamp = Date.parse('2026-08-23T00:55:15Z');
        timestamp <= Date.parse('2026-08-23T01:00:00Z');
        timestamp += 15_000
      )
        spike = parseCronAndBackupState(
          { ...base, diskUsagePercent: 93, backupDiskSustain: spikeSustain },
          new Date(timestamp)
        );
      expect(spike).toMatchObject({ backupLevel: 'healthy', backupErrorCode: null });
      const spikeEvaluation = evaluateMonitor([], {
        monitor: 'backup',
        level: spike.backupLevel,
        observedAt: '2026-08-23T01:00:00.000Z',
        latencyMs: 0,
        details: spike.backup,
        errorCode: spike.backupErrorCode
      });
      expect(spikeEvaluation).toMatchObject({ level: 'healthy', transition: null });

      const sustained = parseCronAndBackupState(
        {
          ...base,
          diskUsagePercent: 93,
          backupDiskSustain: sustainedDiskState('2026-08-23T01:00:00Z', 93)
        },
        new Date('2026-08-23T01:00:00Z')
      );
      expect(sustained.backupErrorCode).toBe('backup_disk_critical');
      const sustainedSample = {
        monitor: 'backup' as const,
        level: sustained.backupLevel,
        observedAt: '2026-08-23T01:00:00.000Z',
        latencyMs: 0,
        details: sustained.backup,
        errorCode: sustained.backupErrorCode
      };
      expect(evaluateMonitor([], sustainedSample)).toMatchObject({
        level: 'critical',
        transition: 'opened'
      });
      const recovered = parseCronAndBackupState(
        { ...base, diskUsagePercent: 84.9, backupDiskSustain: spikeSustain },
        new Date('2026-08-23T01:00:15Z')
      );
      expect(recovered).toMatchObject({ backupLevel: 'healthy', backupErrorCode: null });
      const firstRecoverySample = {
        ...sustainedSample,
        level: recovered.backupLevel,
        observedAt: '2026-08-23T01:00:15.000Z',
        details: recovered.backup,
        errorCode: recovered.backupErrorCode
      };
      const recoveryHistory = [sustainedSample, firstRecoverySample];
      const recoveredAgain = evaluateMonitor(recoveryHistory, {
        ...firstRecoverySample,
        observedAt: '2026-08-23T01:00:30.000Z'
      });
      expect(recoveredAgain).toMatchObject({ level: 'healthy', transition: 'recovered' });
    });
  });

  it('marks the latest backup offsite-verified only for an exact matching basename', () => {
    withDirectory((directory) => {
      const logPath = join(directory, 'backup.log');
      const backupPath = '/srv/backups/newer.age';
      writeFileSync(logPath, `${offsiteLine('2026-08-23T00:45:00Z', backupPath)}\n`);
      const state = parseCronAndBackupState(
        {
          cronLines: [],
          backupFiles: [backupFile('newer.age')],
          backupOffsiteLogPath: logPath,
          diskUsagePercent: 50
        },
        new Date('2026-08-23T01:00:00Z')
      );
      expect(state).toMatchObject({
        backupLevel: 'healthy',
        backupErrorCode: null,
        backup: {
          localOnly: false,
          offsiteVerifiedAt: '2026-08-23T00:45:00.000Z'
        }
      });
    });
  });

  it('keeps a newer backup local-only when only an older basename is in the offsite log', () => {
    withDirectory((directory) => {
      const logPath = join(directory, 'backup.log');
      writeFileSync(logPath, `${offsiteLine('2026-08-23T00:45:00Z', '/srv/backups/older.age')}\n`);
      const state = parseCronAndBackupState(
        {
          cronLines: [],
          backupFiles: [backupFile('newer.age')],
          backupOffsiteLogPath: logPath,
          diskUsagePercent: 50
        },
        new Date('2026-08-23T01:00:00Z')
      );
      expect(state).toMatchObject({
        backupLevel: 'warning',
        backupErrorCode: 'backup_local_only',
        backup: { localOnly: true, offsiteVerifiedAt: null }
      });
    });
  });

  it.each(['missing', 'unreadable', 'garbage'])(
    'treats a %s offsite log as unverified without throwing',
    (kind) => {
      withDirectory((directory) => {
        const logPath = join(directory, 'backup.log');
        if (kind === 'unreadable') mkdirSync(logPath);
        if (kind === 'garbage') writeFileSync(logPath, 'not an offsite verification record\n');
        expect(() =>
          parseCronAndBackupState(
            {
              cronLines: [],
              backupFiles: [backupFile()],
              backupOffsiteLogPath: logPath,
              diskUsagePercent: 50
            },
            new Date('2026-08-23T01:00:00Z')
          )
        ).not.toThrow();
        const state = parseCronAndBackupState(
          {
            cronLines: [],
            backupFiles: [backupFile()],
            backupOffsiteLogPath: logPath,
            diskUsagePercent: 50
          },
          new Date('2026-08-23T01:00:00Z')
        );
        expect(state).toMatchObject({
          backupLevel: 'warning',
          backupErrorCode: 'backup_local_only',
          backup: { localOnly: true, offsiteVerifiedAt: null }
        });
      });
    }
  );

  it('reads only the bounded tail of a large offsite log', () => {
    withDirectory((directory) => {
      const logPath = join(directory, 'backup.log');
      const matchingLine = offsiteLine('2026-08-23T00:45:00Z', '/srv/backups/db.age');
      const largeLog = `${'x'.repeat(70 * 1024)}\n${matchingLine}\n`;
      expect(Buffer.byteLength(largeLog)).toBeGreaterThan(64 * 1024);
      writeFileSync(logPath, largeLog);
      vi.mocked(readSync).mockClear();
      const state = parseCronAndBackupState(
        {
          cronLines: [],
          backupFiles: [backupFile()],
          backupOffsiteLogPath: logPath,
          diskUsagePercent: 50
        },
        new Date('2026-08-23T01:00:00Z')
      );
      expect(state.backup.localOnly).toBe(false);
      expect(vi.mocked(readSync).mock.calls.length).toBe(1);
      const readArguments = vi.mocked(readSync).mock.calls[0] as unknown as unknown[];
      expect(Number(readArguments[3])).toBeLessThanOrEqual(64 * 1024);
    });
  });

  it('keeps backup local-only warning separate from a healthy cron monitor', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-backup-'));
    const postgresDirectory = join(directory, 'postgres');
    mkdirSync(postgresDirectory);
    writeFileSync(join(postgresDirectory, 'edutrack-20260823.dump.age'), 'encrypted');
    writeFileSync(join(postgresDirectory, 'edutrack-20260823.dump.age.sha256'), 'checksum');
    try {
      const state = parseCronAndBackupState(
        { cronLines: [], backupDir: directory, diskUsagePercent: 50 },
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
