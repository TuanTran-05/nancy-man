import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './planner.js';
import type { SafeEnrollmentApplyJournalEntry, SafeEnrollmentPlan } from './types.js';

export type SafeEnrollmentTarget = {
  projectId: string;
  databaseId: string;
};

export type SafeEnrollmentJournalBinding = {
  migrationId: SafeEnrollmentPlan['migrationId'];
  digest: string;
  target: SafeEnrollmentTarget;
};

type SafeEnrollmentApplyJournalFile = SafeEnrollmentJournalBinding & {
  entries: SafeEnrollmentApplyJournalEntry[];
};

export type SafeEnrollmentReviewedFile = {
  digest: string;
  target: SafeEnrollmentTarget;
  approved: false;
  plan: SafeEnrollmentPlan;
};

export function createSafeEnrollmentDigest(input: {
  plan: SafeEnrollmentPlan;
  target: SafeEnrollmentTarget;
}): string {
  return createHash('sha256')
    .update(canonicalJson({ plan: input.plan, target: input.target }))
    .digest('hex');
}

type ReportRow = {
  studentId: string;
  classId: string;
  decision: 'create' | 'exclude';
  reason: string;
  status: string;
  termStart: string;
  termEnd: string;
  documentId: string;
};

function reportRows(plan: SafeEnrollmentPlan): ReportRow[] {
  return plan.items.map((item) => ({
    studentId: item.studentId,
    classId: item.classId || '',
    decision: item.decision,
    reason: item.reason,
    status: item.candidate?.enrollment.status || '',
    termStart: item.candidate?.enrollment.termStart || '',
    termEnd: item.candidate?.enrollment.termEnd || '',
    documentId: item.candidate?.enrollment.id || '',
  }));
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(rows: ReportRow[]): string {
  const headers: Array<keyof ReportRow> = [
    'studentId',
    'classId',
    'decision',
    'reason',
    'status',
    'termStart',
    'termEnd',
    'documentId',
  ];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\r\n');
}

export async function writeSafeEnrollmentReports(input: {
  plan: SafeEnrollmentPlan;
  target: SafeEnrollmentTarget;
  reportDir: string;
}): Promise<{
  digest: string;
  reportPath: string;
  csvPath: string;
  planPath: string;
  journalPath: string;
}> {
  const reportDir = path.resolve(input.reportDir);
  const digest = createSafeEnrollmentDigest({ plan: input.plan, target: input.target });
  const reportPath = path.join(reportDir, 'safe-enrollment-report.json');
  const csvPath = path.join(reportDir, 'safe-enrollment-report.csv');
  const planPath = path.join(reportDir, 'safe-enrollment-plan.json');
  const journalPath = path.join(reportDir, 'safe-enrollment-apply-journal.json');
  const rows = reportRows(input.plan);
  const reviewed: SafeEnrollmentReviewedFile = {
    digest,
    target: input.target,
    approved: false,
    plan: input.plan,
  };

  await mkdir(path.dirname(reportDir), { recursive: true });
  try {
    await mkdir(reportDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('SAFE_ENROLLMENT_REPORT_DIR_EXISTS', { cause: error });
    }
    throw error;
  }
  await Promise.all([
    writeFile(
      reportPath,
      `${JSON.stringify(
        {
          generatedAt: input.plan.generatedAt,
          vietnamDate: input.plan.vietnamDate,
          digest,
          target: input.target,
          summary: input.plan.summary,
          invariants: input.plan.invariants,
          rows,
        },
        null,
        2
      )}\n`,
      { encoding: 'utf8', flag: 'wx' }
    ),
    writeFile(csvPath, `\uFEFF${toCsv(rows)}\r\n`, { encoding: 'utf8', flag: 'wx' }),
    writeFile(planPath, `${JSON.stringify(reviewed, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    }),
    writeFile(
      journalPath,
      `${JSON.stringify(
        { migrationId: input.plan.migrationId, digest, target: input.target, entries: [] },
        null,
        2
      )}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      }
    ),
  ]);
  return { digest, reportPath, csvPath, planPath, journalPath };
}

function isReviewedFile(value: unknown): value is SafeEnrollmentReviewedFile {
  if (!value || typeof value !== 'object') return false;
  const stored = value as Partial<SafeEnrollmentReviewedFile>;
  return Boolean(
    typeof stored.digest === 'string' &&
    stored.target &&
    typeof stored.target.projectId === 'string' &&
    typeof stored.target.databaseId === 'string' &&
    stored.approved === false &&
    stored.plan &&
    stored.plan.migrationId === 'safe-student-course-enrollments-v2' &&
    typeof stored.plan.generatedAt === 'string' &&
    typeof stored.plan.vietnamDate === 'string' &&
    Array.isArray(stored.plan.items)
  );
}

export async function readReviewedSafeEnrollmentPlan(input: {
  planPath: string;
  confirmDigest: string;
  expectedProjectId: string;
  expectedDatabaseId: string;
  currentVietnamDate: string;
  enforceCurrentDate?: boolean;
}): Promise<SafeEnrollmentReviewedFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.resolve(input.planPath), 'utf8'));
  } catch {
    throw new Error('SAFE_ENROLLMENT_REVIEWED_PLAN_INVALID');
  }
  if (!isReviewedFile(parsed)) throw new Error('SAFE_ENROLLMENT_REVIEWED_PLAN_INVALID');
  if (
    parsed.target.projectId !== input.expectedProjectId ||
    parsed.target.databaseId !== input.expectedDatabaseId
  ) {
    throw new Error('SAFE_ENROLLMENT_REVIEWED_TARGET_MISMATCH');
  }
  if (input.enforceCurrentDate !== false && parsed.plan.vietnamDate !== input.currentVietnamDate) {
    throw new Error('SAFE_ENROLLMENT_DATE_ROLLOVER');
  }
  const computed = createSafeEnrollmentDigest({ plan: parsed.plan, target: parsed.target });
  if (computed !== parsed.digest || input.confirmDigest.trim() !== parsed.digest) {
    throw new Error('SAFE_ENROLLMENT_REVIEWED_DIGEST_MISMATCH');
  }
  return parsed;
}

export async function appendCreatedEnrollmentJournal(input: {
  journalPath: string;
  entry: SafeEnrollmentApplyJournalEntry;
  binding: SafeEnrollmentJournalBinding;
}): Promise<void> {
  const stored = await readApplyJournalFile(input.journalPath);
  assertJournalBinding(stored, input.binding);
  const entries = stored.entries;
  const existing = entries.find((entry) => entry.documentId === input.entry.documentId);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(input.entry)) {
      throw new Error('SAFE_ENROLLMENT_JOURNAL_CONFLICT');
    }
    return;
  }
  const next = [...entries, input.entry].sort((left, right) =>
    left.documentId.localeCompare(right.documentId)
  );
  const journalPath = path.resolve(input.journalPath);
  await mkdir(path.dirname(journalPath), { recursive: true });
  const temporaryPath = `${journalPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ ...input.binding, entries: next }, null, 2)}\n`,
    'utf8'
  );
  await rename(temporaryPath, journalPath);
}

export async function readApplyJournal(
  journalPath: string,
  expectedBinding?: SafeEnrollmentJournalBinding
): Promise<SafeEnrollmentApplyJournalEntry[]> {
  const parsed = await readApplyJournalFile(journalPath);
  if (expectedBinding) assertJournalBinding(parsed, expectedBinding);
  return parsed.entries;
}

function assertJournalBinding(
  stored: SafeEnrollmentApplyJournalFile,
  expected: SafeEnrollmentJournalBinding
): void {
  if (
    stored.migrationId !== expected.migrationId ||
    stored.digest !== expected.digest ||
    canonicalJson(stored.target) !== canonicalJson(expected.target)
  ) {
    throw new Error('SAFE_ENROLLMENT_JOURNAL_BINDING_MISMATCH');
  }
}

async function readApplyJournalFile(journalPath: string): Promise<SafeEnrollmentApplyJournalFile> {
  try {
    const parsed = JSON.parse(
      await readFile(path.resolve(journalPath), 'utf8')
    ) as Partial<SafeEnrollmentApplyJournalFile>;
    if (
      parsed.migrationId !== 'safe-student-course-enrollments-v2' ||
      typeof parsed.digest !== 'string' ||
      !parsed.target ||
      typeof parsed.target.projectId !== 'string' ||
      typeof parsed.target.databaseId !== 'string' ||
      !Array.isArray(parsed.entries)
    ) {
      throw new Error('invalid');
    }
    return parsed as SafeEnrollmentApplyJournalFile;
  } catch {
    throw new Error('SAFE_ENROLLMENT_JOURNAL_INVALID');
  }
}
