import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';
import {
  buildRedactedReportRows,
  readReviewedBackfillPlan,
  writeBackfillReports,
} from './reporter.js';
import type { BackfillRunPlan } from './types.js';

const temporaryDirectories: string[] = [];
const target = {
  projectId: 'gen-lang-client-0014842483',
  databaseId: 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a',
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function record(studentName = 'Nguyễn Văn An'): CourseClosingRecord {
  return {
    id: 'course-1__student-1',
    recordVersion: 1,
    closingMonth: '2026-07',
    courseId: 'course-1',
    classId: 'class-1',
    className: 'IELTS 6.0',
    classNameNormalized: 'ielts 6.0',
    courseStartDate: '2026-03-18',
    courseEndDate: '2026-07-18',
    studentId: 'student-1',
    studentName,
    studentNameNormalized: 'nguyen van an',
    studentCode: 'HV001',
    teacherId: 'teacher-1',
    teacherName: 'Trần Minh',
    evaluationDocument: {
      type: 'evaluation',
      status: 'not_requested',
      templateVersion: 1,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      attempts: 0,
    },
    tuitionDocument: {
      type: 'tuition',
      status: 'not_requested',
      templateVersion: 1,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      attempts: 0,
    },
    createdAt: '2026-07-25T09:00:00.000Z',
    updatedAt: '2026-07-25T09:00:00.000Z',
  };
}

function plan(studentName?: string): BackfillRunPlan {
  const candidate = Object.assign(record(studentName), {
    phone: '0900000000',
    email: 'an@example.com',
    password: 'secret',
    privateKey: 'private-key-value',
  });
  return {
    generatedAt: '2026-07-25T09:00:00.000Z',
    summary: { create: 1, merge: 0, unchanged: 0, ambiguous: 0, skipped: 0 },
    items: [
      {
        recordId: candidate.id,
        classId: candidate.classId,
        className: candidate.className,
        courseId: candidate.courseId,
        studentId: candidate.studentId,
        studentCode: candidate.studentCode,
        studentName: candidate.studentName,
        decision: 'create',
        reasons: ['PLANNED_CREATE'],
        candidate,
      },
    ],
  };
}

const sourceCounts = {
  classes: 1,
  students: 1,
  evaluations: 0,
  notifications: 0,
  ledgers: 0,
  enrollments: 0,
  users: 1,
  existingRecords: 0,
};

describe('course-closing backfill reporter', () => {
  it('projects only redacted operational fields', () => {
    const rows = buildRedactedReportRows(plan());
    const serialized = JSON.stringify(rows);

    expect(rows[0]).toMatchObject({
      recordId: 'course-1__student-1',
      studentName: 'Nguyễn Văn An',
      decision: 'create',
      hasEvaluation: false,
      hasTuition: false,
    });
    expect(serialized).not.toMatch(/0900000000|an@example\.com|secret|private-key-value/);
  });

  it('writes deterministic JSON and correctly escaped CSV', async () => {
    const reportDir = await mkdtemp(path.join(tmpdir(), 'closing-report-'));
    temporaryDirectories.push(reportDir);

    const first = await writeBackfillReports({
      plan: plan('Nguyễn, "An"\nA'),
      sourceCounts,
      target,
      reportDir,
    });
    const second = await writeBackfillReports({
      plan: plan('Nguyễn, "An"\nA'),
      sourceCounts,
      target,
      reportDir,
    });
    const csv = await readFile(first.csvPath, 'utf8');
    const json = JSON.parse(await readFile(first.jsonPath, 'utf8'));
    const reviewed = await readReviewedBackfillPlan({
      planPath: first.planPath,
      confirmDigest: first.digest,
      expectedProjectId: target.projectId,
      expectedDatabaseId: target.databaseId,
    });

    expect(first.digest).toBe(second.digest);
    expect(csv).toContain('"Nguyễn, ""An""\nA"');
    expect(json).toMatchObject({
      digest: first.digest,
      target,
      sourceCounts,
      summary: { create: 1 },
    });
    expect(reviewed.plan.items[0].candidate).not.toHaveProperty('phone');
    expect(reviewed.digest).toBe(first.digest);
  });

  it('rejects an apply confirmation for a different reviewed digest', async () => {
    const reportDir = await mkdtemp(path.join(tmpdir(), 'closing-report-'));
    temporaryDirectories.push(reportDir);
    const manifest = await writeBackfillReports({
      plan: plan(),
      sourceCounts,
      target,
      reportDir,
    });

    await expect(
      readReviewedBackfillPlan({
        planPath: manifest.planPath,
        confirmDigest: 'different-digest',
        expectedProjectId: target.projectId,
        expectedDatabaseId: target.databaseId,
      })
    ).rejects.toThrow('BACKFILL_REVIEWED_DIGEST_MISMATCH');
  });

  it('rejects a reviewed artifact from another Firebase target', async () => {
    const reportDir = await mkdtemp(path.join(tmpdir(), 'closing-report-'));
    temporaryDirectories.push(reportDir);
    const manifest = await writeBackfillReports({
      plan: plan(),
      sourceCounts,
      target,
      reportDir,
    });

    await expect(
      readReviewedBackfillPlan({
        planPath: manifest.planPath,
        confirmDigest: manifest.digest,
        expectedProjectId: 'another-project',
        expectedDatabaseId: target.databaseId,
      })
    ).rejects.toThrow('BACKFILL_REVIEWED_TARGET_MISMATCH');
  });

  it('neutralizes spreadsheet formulas in CSV text cells', async () => {
    const reportDir = await mkdtemp(path.join(tmpdir(), 'closing-report-'));
    temporaryDirectories.push(reportDir);
    const manifest = await writeBackfillReports({
      plan: plan('=HYPERLINK("https://example.invalid")'),
      sourceCounts,
      target,
      reportDir,
    });
    const csv = await readFile(manifest.csvPath, 'utf8');

    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toContain(`,"=HYPERLINK`);
  });
});
