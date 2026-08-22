import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';
import type { BackfillSourceLoadSummary } from './documentStoreSources.js';
import type { BackfillDecisionKind, BackfillRunPlan } from './types.js';

export interface BackfillReportRow {
  recordId: string;
  classId: string;
  className: string;
  courseId: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  decision: BackfillDecisionKind;
  reasons: string;
  hasEvaluation: boolean;
  hasTuition: boolean;
}

export interface BackfillReportManifest {
  generatedAt: string;
  digest: string;
  target: BackfillTarget;
  jsonPath: string;
  csvPath: string;
  planPath: string;
  summary: BackfillRunPlan['summary'];
  sourceCounts: BackfillSourceLoadSummary;
}

export interface BackfillTarget {
  projectId: string;
  databaseId: string;
}

export function buildRedactedReportRows(plan: BackfillRunPlan): BackfillReportRow[] {
  return plan.items
    .map((item) => ({
      recordId: item.recordId,
      classId: item.classId,
      className: item.className,
      courseId: item.courseId,
      studentId: item.studentId,
      studentCode: item.studentCode,
      studentName: item.studentName,
      decision: item.decision,
      reasons: item.reasons.join('|'),
      hasEvaluation: Boolean(item.candidate?.evaluationSnapshot),
      hasTuition: Boolean(item.candidate?.tuitionSnapshot),
    }))
    .sort(
      (left, right) =>
        left.className.localeCompare(right.className, 'vi') ||
        left.studentName.localeCompare(right.studentName, 'vi') ||
        left.recordId.localeCompare(right.recordId)
    );
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const text = typeof value === 'string' && /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: BackfillReportRow[]): string {
  const headers: Array<keyof BackfillReportRow> = [
    'recordId',
    'classId',
    'className',
    'courseId',
    'studentId',
    'studentCode',
    'studentName',
    'decision',
    'reasons',
    'hasEvaluation',
    'hasTuition',
  ];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\r\n');
}

function sanitizeCandidate(record: CourseClosingRecord): CourseClosingRecord {
  return {
    id: record.id,
    recordVersion: record.recordVersion,
    closingMonth: record.closingMonth,
    courseId: record.courseId,
    classId: record.classId,
    className: record.className,
    classNameNormalized: record.classNameNormalized,
    courseStartDate: record.courseStartDate,
    courseEndDate: record.courseEndDate,
    studentId: record.studentId,
    studentName: record.studentName,
    studentNameNormalized: record.studentNameNormalized,
    studentCode: record.studentCode,
    teacherId: record.teacherId,
    teacherName: record.teacherName,
    ...(record.evaluationSnapshot ? { evaluationSnapshot: record.evaluationSnapshot } : {}),
    ...(record.tuitionSnapshot ? { tuitionSnapshot: record.tuitionSnapshot } : {}),
    evaluationDocument: record.evaluationDocument,
    tuitionDocument: record.tuitionDocument,
    ...(record.backfill ? { backfill: record.backfill } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function sanitizePlan(plan: BackfillRunPlan): BackfillRunPlan {
  return {
    generatedAt: plan.generatedAt,
    summary: plan.summary,
    items: plan.items.map((item) => ({
      recordId: item.recordId,
      classId: item.classId,
      className: item.className,
      courseId: item.courseId,
      studentId: item.studentId,
      studentCode: item.studentCode,
      studentName: item.studentName,
      decision: item.decision,
      reasons: [...item.reasons],
      ...(item.candidate ? { candidate: sanitizeCandidate(item.candidate) } : {}),
      ...(item.expectedExists !== undefined ? { expectedExists: item.expectedExists } : {}),
      ...(item.existingVersion ? { existingVersion: item.existingVersion } : {}),
    })),
  };
}

export function createBackfillDigest(input: {
  plan: BackfillRunPlan;
  sourceCounts: BackfillSourceLoadSummary;
  target: BackfillTarget;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        target: input.target,
        sourceCounts: input.sourceCounts,
        plan: sanitizePlan(input.plan),
      })
    )
    .digest('hex');
}

export async function readReviewedBackfillPlan(input: {
  planPath: string;
  confirmDigest: string;
  expectedProjectId: string;
  expectedDatabaseId: string;
}): Promise<{
  digest: string;
  target: BackfillTarget;
  sourceCounts: BackfillSourceLoadSummary;
  plan: BackfillRunPlan;
}> {
  const stored = JSON.parse(await readFile(path.resolve(input.planPath), 'utf8')) as {
    digest?: string;
    target?: BackfillTarget;
    sourceCounts?: BackfillSourceLoadSummary;
    plan?: BackfillRunPlan;
  };
  if (!stored.plan || !stored.sourceCounts || !stored.digest || !stored.target) {
    throw new Error('BACKFILL_REVIEWED_PLAN_INVALID');
  }
  if (
    stored.target.projectId !== input.expectedProjectId ||
    stored.target.databaseId !== input.expectedDatabaseId
  ) {
    throw new Error('BACKFILL_REVIEWED_TARGET_MISMATCH');
  }
  const computed = createBackfillDigest({
    plan: stored.plan,
    sourceCounts: stored.sourceCounts,
    target: stored.target,
  });
  if (computed !== stored.digest || stored.digest !== input.confirmDigest.trim()) {
    throw new Error('BACKFILL_REVIEWED_DIGEST_MISMATCH');
  }
  return {
    digest: stored.digest,
    target: stored.target,
    sourceCounts: stored.sourceCounts,
    plan: stored.plan,
  };
}

export async function writeBackfillReports(input: {
  plan: BackfillRunPlan;
  sourceCounts: BackfillSourceLoadSummary;
  target: BackfillTarget;
  reportDir: string;
}): Promise<BackfillReportManifest> {
  const reportDir = path.resolve(input.reportDir);
  const rows = buildRedactedReportRows(input.plan);
  const sanitizedPlan = sanitizePlan(input.plan);
  const digest = createBackfillDigest({
    plan: sanitizedPlan,
    sourceCounts: input.sourceCounts,
    target: input.target,
  });
  const jsonPath = path.join(reportDir, 'course-closing-backfill-report.json');
  const csvPath = path.join(reportDir, 'course-closing-backfill-report.csv');
  const planPath = path.join(reportDir, 'course-closing-backfill-plan.json');
  const json = {
    generatedAt: input.plan.generatedAt,
    digest,
    target: input.target,
    sourceCounts: input.sourceCounts,
    summary: input.plan.summary,
    rows,
  };

  await mkdir(reportDir, { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8'),
    writeFile(csvPath, `\uFEFF${toCsv(rows)}\r\n`, 'utf8'),
    writeFile(
      planPath,
      `${JSON.stringify(
        {
          digest,
          target: input.target,
          sourceCounts: input.sourceCounts,
          plan: sanitizedPlan,
        },
        null,
        2
      )}\n`,
      'utf8'
    ),
  ]);

  return {
    generatedAt: input.plan.generatedAt,
    digest,
    target: input.target,
    jsonPath,
    csvPath,
    planPath,
    summary: input.plan.summary,
    sourceCounts: input.sourceCounts,
  };
}
