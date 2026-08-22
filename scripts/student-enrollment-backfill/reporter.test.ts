import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planSafeStudentEnrollmentBackfill } from './planner.js';
import {
  appendCreatedEnrollmentJournal,
  createSafeEnrollmentDigest,
  readApplyJournal,
  readReviewedSafeEnrollmentPlan,
  writeSafeEnrollmentReports,
} from './reporter.js';
import type { SafeEnrollmentApplyJournalEntry, SafeEnrollmentPlan } from './types.js';

const PROJECT_ID = 'project-safe';
const DATABASE_ID = 'database-safe';
const VIETNAM_DATE = '2026-08-01';
const tempDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'safe-enrollment-reporter-'));
  tempDirectories.push(directory);
  return directory;
}

async function freshReportDirectory(): Promise<string> {
  return path.join(await tempDirectory(), 'run');
}

function samplePlan(): SafeEnrollmentPlan {
  return planSafeStudentEnrollmentBackfill({
    generatedAt: '2026-08-01T02:00:00.000Z',
    vietnamDate: VIETNAM_DATE,
    students: [
      {
        id: 'student-1',
        data: { classId: 'class-1', enrollmentStatus: 'active' },
        updateTime: '2026-08-01T01:00:00.000Z',
      },
    ],
    classes: [
      {
        id: 'class-1',
        data: { startDate: '2026-08-01', endDate: '2026-08-31' },
        updateTime: '2026-08-01T01:00:00.000Z',
      },
    ],
    existingByStudent: new Map(),
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('safe enrollment reports', () => {
  it('creates the same digest for canonically equal plans', () => {
    const plan = samplePlan();
    const reordered = JSON.parse(JSON.stringify(plan)) as SafeEnrollmentPlan;
    reordered.summary = {
      byStatus: { on_leave: 0, active: 1 },
      excluded: Object.fromEntries(
        Object.entries(plan.summary.excluded).reverse()
      ) as SafeEnrollmentPlan['summary']['excluded'],
      create: 1,
      scannedStudents: 1,
    };

    const first = createSafeEnrollmentDigest({
      plan,
      target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
    });
    const second = createSafeEnrollmentDigest({
      target: { databaseId: DATABASE_ID, projectId: PROJECT_ID },
      plan: reordered,
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it('writes a reviewed plan without raw source documents and escapes CSV formulas', async () => {
    const reportDir = await freshReportDirectory();
    const plan = samplePlan();
    plan.items.push({
      studentId: '+student-formula',
      classId: '=SUM(A1:A2)',
      decision: 'exclude',
      reason: 'NON_CURRENT_STATUS',
    });
    plan.summary.scannedStudents += 1;
    plan.summary.excluded.NON_CURRENT_STATUS += 1;

    const result = await writeSafeEnrollmentReports({
      plan,
      target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
      reportDir,
    });

    const reviewed = JSON.parse(await readFile(result.planPath, 'utf8')) as Record<string, unknown>;
    const csv = await readFile(result.csvPath, 'utf8');
    expect(reviewed).toMatchObject({
      approved: false,
      digest: result.digest,
      target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
    });
    expect(JSON.stringify(reviewed)).not.toContain('terms');
    expect(JSON.stringify(reviewed)).not.toContain('rawStudent');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'+student-formula");
    expect(csv).toContain("'=SUM(A1:A2)");
  });

  it('reads an exact same-day reviewed plan', async () => {
    const reportDir = await freshReportDirectory();
    const written = await writeSafeEnrollmentReports({
      plan: samplePlan(),
      target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
      reportDir,
    });

    const reviewed = await readReviewedSafeEnrollmentPlan({
      planPath: written.planPath,
      confirmDigest: written.digest,
      expectedProjectId: PROJECT_ID,
      expectedDatabaseId: DATABASE_ID,
      currentVietnamDate: VIETNAM_DATE,
    });
    expect(reviewed.digest).toBe(written.digest);
    expect(reviewed.plan.summary.create).toBe(1);
  });

  it.each([
    ['wrong-project', DATABASE_ID, VIETNAM_DATE, 'SAFE_ENROLLMENT_REVIEWED_TARGET_MISMATCH'],
    [PROJECT_ID, 'wrong-database', VIETNAM_DATE, 'SAFE_ENROLLMENT_REVIEWED_TARGET_MISMATCH'],
    [PROJECT_ID, DATABASE_ID, '2026-08-02', 'SAFE_ENROLLMENT_DATE_ROLLOVER'],
  ] as const)(
    'rejects reviewed target/date mismatch',
    async (expectedProjectId, expectedDatabaseId, currentVietnamDate, errorCode) => {
      const reportDir = await freshReportDirectory();
      const written = await writeSafeEnrollmentReports({
        plan: samplePlan(),
        target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
        reportDir,
      });
      await expect(
        readReviewedSafeEnrollmentPlan({
          planPath: written.planPath,
          confirmDigest: written.digest,
          expectedProjectId,
          expectedDatabaseId,
          currentVietnamDate,
        })
      ).rejects.toThrow(errorCode);
    }
  );

  it('allows an older reviewed plan for recovery when the date guard is disabled', async () => {
    const reportDir = await freshReportDirectory();
    const written = await writeSafeEnrollmentReports({
      plan: samplePlan(),
      target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
      reportDir,
    });
    await expect(
      readReviewedSafeEnrollmentPlan({
        planPath: written.planPath,
        confirmDigest: written.digest,
        expectedProjectId: PROJECT_ID,
        expectedDatabaseId: DATABASE_ID,
        currentVietnamDate: '2026-08-02',
        enforceCurrentDate: false,
      })
    ).resolves.toMatchObject({ digest: written.digest });
  });

  it('rejects a candidate payload changed after review', async () => {
    const reportDir = await freshReportDirectory();
    const written = await writeSafeEnrollmentReports({
      plan: samplePlan(),
      target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
      reportDir,
    });
    const stored = JSON.parse(await readFile(written.planPath, 'utf8')) as {
      plan: SafeEnrollmentPlan;
    };
    stored.plan.items[0].candidate!.enrollment.status = 'on_leave';
    await writeFile(written.planPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    await expect(
      readReviewedSafeEnrollmentPlan({
        planPath: written.planPath,
        confirmDigest: written.digest,
        expectedProjectId: PROJECT_ID,
        expectedDatabaseId: DATABASE_ID,
        currentVietnamDate: VIETNAM_DATE,
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_REVIEWED_DIGEST_MISMATCH');
  });

  it('rejects a reviewed file missing required fields', async () => {
    const reportDir = await tempDirectory();
    const planPath = path.join(reportDir, 'invalid-plan.json');
    await writeFile(planPath, JSON.stringify({ target: {} }), 'utf8');
    await expect(
      readReviewedSafeEnrollmentPlan({
        planPath,
        confirmDigest: 'a'.repeat(64),
        expectedProjectId: PROJECT_ID,
        expectedDatabaseId: DATABASE_ID,
        currentVietnamDate: VIETNAM_DATE,
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_REVIEWED_PLAN_INVALID');
  });

  it('refuses to reuse a report directory and preserves its existing journal', async () => {
    const reportDir = await freshReportDirectory();
    const first = await writeSafeEnrollmentReports({
      plan: samplePlan(),
      target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
      reportDir,
    });
    const existingJournal = `${JSON.stringify({ entries: [{ documentId: 'already-created' }] })}\n`;
    await writeFile(first.journalPath, existingJournal, 'utf8');

    await expect(
      writeSafeEnrollmentReports({
        plan: samplePlan(),
        target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
        reportDir,
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_REPORT_DIR_EXISTS');
    expect(await readFile(first.journalPath, 'utf8')).toBe(existingJournal);
  });
});

describe('safe enrollment apply journal', () => {
  const binding = {
    migrationId: 'safe-student-course-enrollments-v2' as const,
    digest: 'a'.repeat(64),
    target: { projectId: PROJECT_ID, databaseId: DATABASE_ID },
  };
  const entry: SafeEnrollmentApplyJournalEntry = {
    documentId: 'enrollment-1',
    studentId: 'student-1',
    payloadFingerprint: 'b'.repeat(64),
    createdAt: '2026-08-01T02:10:00.000Z',
  };

  it('atomically appends unique entries and keeps an identical retry idempotent', async () => {
    const reportDir = await tempDirectory();
    const journalPath = path.join(reportDir, 'safe-enrollment-apply-journal.json');
    await writeFile(journalPath, `${JSON.stringify({ ...binding, entries: [] })}\n`, 'utf8');
    await appendCreatedEnrollmentJournal({ journalPath, entry, binding });
    await appendCreatedEnrollmentJournal({ journalPath, entry, binding });
    expect(await readApplyJournal(journalPath)).toEqual([entry]);
  });

  it('rejects a conflicting entry for an existing document ID', async () => {
    const reportDir = await tempDirectory();
    const journalPath = path.join(reportDir, 'safe-enrollment-apply-journal.json');
    await writeFile(journalPath, `${JSON.stringify({ ...binding, entries: [] })}\n`, 'utf8');
    await appendCreatedEnrollmentJournal({ journalPath, entry, binding });
    await expect(
      appendCreatedEnrollmentJournal({
        journalPath,
        entry: { ...entry, payloadFingerprint: 'c'.repeat(64) },
        binding,
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_JOURNAL_CONFLICT');
  });

  it('rejects a local journal bound to another reviewed digest', async () => {
    const reportDir = await tempDirectory();
    const journalPath = path.join(reportDir, 'safe-enrollment-apply-journal.json');
    await writeFile(journalPath, `${JSON.stringify({ ...binding, entries: [entry] })}\n`, 'utf8');
    await expect(
      readApplyJournal(journalPath, { ...binding, digest: 'f'.repeat(64) })
    ).rejects.toThrow('SAFE_ENROLLMENT_JOURNAL_BINDING_MISMATCH');
  });
});
