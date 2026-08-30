import { readdirSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MonitorLevel } from '../../shared/models.js';

export interface BackupFileInput {
  name: string;
  mtimeMs: number;
  size: number;
  encrypted?: boolean;
  checksumPresent?: boolean;
}

export interface CronBackupInput {
  cronLines: string[];
  backupFiles?: BackupFileInput[];
  backupDir?: string;
  diskUsagePercent?: number;
}

export interface ParsedCronBackupState {
  cron: Array<{ job: string; status: 'success' | 'failure' | 'skipped'; observedAt: string }>;
  backup: {
    latestBackupAt: string | null;
    ageHours: number | null;
    encrypted: boolean;
    checksumPresent: boolean;
    localOnly: true;
    diskUsagePercent: number | null;
  };
  cronLevel: MonitorLevel;
  cronErrorCode: string | null;
  backupLevel: MonitorLevel;
  backupErrorCode: string | null;
}

const allowedFile = /^[A-Za-z0-9._-]+\.(?:enc|gpg|age|backup|dump)$/u;

function loadBackupFiles(input: CronBackupInput): BackupFileInput[] {
  if (input.backupFiles) return input.backupFiles;
  if (!input.backupDir) return [];
  const directories = [...new Set([input.backupDir, join(input.backupDir, 'postgres')])];
  const files: BackupFileInput[] = [];
  for (const directory of directories) {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !allowedFile.test(entry.name)) continue;
        const fullPath = join(directory, entry.name);
        const stat = statSync(fullPath);
        const checksumPresent =
          statSync(`${fullPath}.sha256`, { throwIfNoEntry: false }) !== undefined;
        files.push({
          name: entry.name,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          encrypted: /\.(?:enc|gpg|age)$/u.test(entry.name),
          checksumPresent
        });
      }
    } catch {
      // A missing or unreadable backup directory is represented as stale below.
    }
  }
  return files;
}

export function parseCronAndBackupState(
  input: CronBackupInput,
  now: Date = new Date()
): ParsedCronBackupState {
  const observedAt = now.toISOString();
  const cron: ParsedCronBackupState['cron'] = [];
  for (const line of input.cronLines) {
    const match = line.match(
      /(?:run-cron\.sh|ops-cron|cron)\s+job=([A-Za-z0-9._-]{1,80})\s+(?:status|result)=(success|failure|failed|skipped)/iu
    );
    if (!match) continue;
    cron.push({
      job: match[1],
      status:
        match[2].toLowerCase() === 'success'
          ? 'success'
          : match[2].toLowerCase() === 'skipped'
            ? 'skipped'
            : 'failure',
      observedAt
    });
  }
  const files = loadBackupFiles(input).filter((file) => allowedFile.test(file.name));
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = files[0];
  const ageHours = latest ? Math.max(0, (now.getTime() - latest.mtimeMs) / 3_600_000) : null;
  const diskUsagePercent =
    input.diskUsagePercent ??
    (() => {
      if (!input.backupDir) return null;
      try {
        const stats = statfsSync(input.backupDir);
        return ((Number(stats.blocks) - Number(stats.bavail)) / Number(stats.blocks)) * 100;
      } catch {
        return null;
      }
    })();
  const failure = cron.some((item) => item.status === 'failure');
  const cronLevel: MonitorLevel = failure ? 'critical' : 'healthy';
  const cronErrorCode = failure ? 'cron_failure' : null;
  let backupLevel: MonitorLevel = 'healthy';
  let backupErrorCode: string | null = null;
  if (!latest || (ageHours !== null && ageHours > 26)) {
    backupLevel = 'critical';
    backupErrorCode = 'backup_stale';
  } else if (!latest.encrypted || !latest.checksumPresent) {
    backupLevel = 'critical';
    backupErrorCode = 'backup_unverified';
  } else if (diskUsagePercent !== null && diskUsagePercent > 90) {
    backupLevel = 'critical';
    backupErrorCode = 'backup_disk_critical';
  } else if (diskUsagePercent !== null && diskUsagePercent > 80) {
    backupLevel = 'warning';
    backupErrorCode = 'backup_disk_warning';
  } else if (latest.encrypted) {
    backupLevel = 'warning';
    backupErrorCode = 'backup_local_only';
  }
  return {
    cron,
    backup: {
      latestBackupAt: latest ? new Date(latest.mtimeMs).toISOString() : null,
      ageHours,
      encrypted: Boolean(latest?.encrypted),
      checksumPresent: Boolean(latest?.checksumPresent),
      localOnly: true,
      diskUsagePercent
    },
    cronLevel,
    cronErrorCode,
    backupLevel,
    backupErrorCode
  };
}
