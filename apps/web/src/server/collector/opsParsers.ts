import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  statfsSync,
  statSync
} from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import type { MonitorLevel } from '../../shared/models.js';

const OFFSITE_LOG_TAIL_BYTES = 64 * 1024;
const DISK_WARNING_THRESHOLD_PERCENT = 85;
const DISK_CRITICAL_THRESHOLD_PERCENT = 92;
const DISK_SUSTAINED_DURATION_MS = 30 * 60_000;
const DISK_MAX_OBSERVATION_GAP_MS = 30_000;

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
  backupOffsiteLogPath?: string;
  backupHistory?: Array<{ observedAt: string; diskUsagePercent: number | null }>;
  diskUsagePercent?: number;
}

export interface ParsedCronBackupState {
  cron: Array<{ job: string; status: 'success' | 'failure' | 'skipped'; observedAt: string }>;
  backup: {
    latestBackupAt: string | null;
    ageHours: number | null;
    encrypted: boolean;
    checksumPresent: boolean;
    localOnly: boolean;
    offsiteVerifiedAt: string | null;
    diskUsagePercent: number | null;
  };
  cronLevel: MonitorLevel;
  cronErrorCode: string | null;
  backupLevel: MonitorLevel;
  backupErrorCode: string | null;
}

const allowedFile = /^[A-Za-z0-9._-]+\.(?:enc|gpg|age|backup|dump)$/u;

function readOffsiteLogTail(path: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    const size = fstatSync(descriptor).size;
    const bytesToRead = Math.min(size, OFFSITE_LOG_TAIL_BYTES);
    if (bytesToRead === 0) return '';
    const start = size - bytesToRead;
    const buffer = Buffer.allocUnsafe(bytesToRead);
    let bytesRead = 0;
    while (bytesRead < bytesToRead) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        bytesToRead - bytesRead,
        start + bytesRead
      );
      if (count === 0) break;
      bytesRead += count;
    }
    let tail = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstNewline = tail.indexOf('\n');
      tail = firstNewline < 0 ? '' : tail.slice(firstNewline + 1);
    }
    return tail;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function findOffsiteVerification(
  logPath: string | undefined,
  latestBackupName: string | undefined
): string | null {
  if (!logPath) return null;
  let tail: string;
  try {
    tail = readOffsiteLogTail(logPath);
  } catch (error) {
    captureOpsException(error, {
      code: 'BACKUP_OFFSITE_LOG_READ_FAILED',
      source: 'job',
      status: 500
    });
    return null;
  }
  if (!latestBackupName) return null;
  let latestTimestamp: string | null = null;
  let latestEpoch = -Infinity;
  for (const rawLine of tail.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const match = line.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})) encrypted PostgreSQL backup verified locally and offsite: (\/.+)$/u
    );
    if (!match || !isAbsolute(match[2]) || basename(match[2]) !== latestBackupName) continue;
    const epoch = Date.parse(match[1]);
    if (!Number.isFinite(epoch) || epoch <= latestEpoch) continue;
    latestEpoch = epoch;
    latestTimestamp = new Date(epoch).toISOString();
  }
  return latestTimestamp;
}

function diskConditionSustained(
  history: NonNullable<CronBackupInput['backupHistory']>,
  diskUsagePercent: number | null,
  threshold: number,
  now: Date
): boolean {
  if (diskUsagePercent === null || diskUsagePercent <= threshold) return false;
  const samples = [...history, { observedAt: now.toISOString(), diskUsagePercent }];
  let first = samples.length - 1;
  while (first > 0) {
    const previous = samples[first - 1];
    const current = samples[first];
    const previousPercent = previous.diskUsagePercent;
    const previousAt = Date.parse(previous.observedAt);
    const currentAt = Date.parse(current.observedAt);
    if (
      previousPercent === null ||
      previousPercent <= threshold ||
      !Number.isFinite(previousAt) ||
      !Number.isFinite(currentAt) ||
      currentAt < previousAt ||
      currentAt - previousAt > DISK_MAX_OBSERVATION_GAP_MS
    )
      break;
    first -= 1;
  }
  const observed = samples.slice(first);
  if (observed.length < 2) return false;
  const startedAt = Date.parse(observed[0].observedAt);
  const latestAt = Date.parse(observed[observed.length - 1].observedAt);
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(latestAt) &&
    latestAt - startedAt >= DISK_SUSTAINED_DURATION_MS
  );
}

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
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'job',
        status: 500
      });
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
  const offsiteVerifiedAt = findOffsiteVerification(input.backupOffsiteLogPath, latest?.name);
  const localOnly = offsiteVerifiedAt === null;
  const diskUsagePercent =
    input.diskUsagePercent ??
    (() => {
      if (!input.backupDir) return null;
      try {
        const stats = statfsSync(input.backupDir);
        return ((Number(stats.blocks) - Number(stats.bavail)) / Number(stats.blocks)) * 100;
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'job',
          status: 500
        });
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
  } else if (
    diskConditionSustained(
      input.backupHistory ?? [],
      diskUsagePercent,
      DISK_CRITICAL_THRESHOLD_PERCENT,
      now
    )
  ) {
    backupLevel = 'critical';
    backupErrorCode = 'backup_disk_critical';
  } else if (
    diskConditionSustained(
      input.backupHistory ?? [],
      diskUsagePercent,
      DISK_WARNING_THRESHOLD_PERCENT,
      now
    )
  ) {
    backupLevel = 'warning';
    backupErrorCode = 'backup_disk_warning';
  } else if (localOnly) {
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
      localOnly,
      offsiteVerifiedAt,
      diskUsagePercent
    },
    cronLevel,
    cronErrorCode,
    backupLevel,
    backupErrorCode
  };
}
