import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  parseSafeEnrollmentBackfillArgs,
  runSafeEnrollmentBackfill,
  type SafeEnrollmentRunnerDependencies,
} from './backfill-student-course-enrollments.js';
import { planSafeStudentEnrollmentBackfill } from './student-enrollment-backfill/planner.js';
import {
  createSafeEnrollmentDigest,
  type SafeEnrollmentReviewedFile,
} from './student-enrollment-backfill/reporter.js';

const cwd = 'C:\\workspace';
const projectId = 'project-safe';
const databaseId = 'database-safe';
const vietnamDate = '2026-08-01';
const generatedAt = '2026-08-01T02:00:00.000Z';

function reviewed(): SafeEnrollmentReviewedFile {
  const plan = planSafeStudentEnrollmentBackfill({
    generatedAt,
    vietnamDate,
    students: [{ id: 'student-1', data: { classId: 'class-1', enrollmentStatus: 'active' } }],
    classes: [{ id: 'class-1', data: { startDate: '2026-08-01', endDate: '2026-08-31' } }],
    existingByStudent: new Map(),
  });
  const target = { projectId, databaseId };
  return { approved: false, target, plan, digest: createSafeEnrollmentDigest({ plan, target }) };
}

describe('safe enrollment CLI arguments', () => {
  it('defaults to a read-only dry-run report', () => {
    expect(parseSafeEnrollmentBackfillArgs([], cwd)).toEqual({
      mode: 'dry-run',
      applyRollback: false,
      reportDir: path.resolve(cwd, 'scratch', 'safe-student-enrollment-backfill'),
      help: false,
    });
  });

  it('parses a fully confirmed apply without weakening target checks', () => {
    expect(
      parseSafeEnrollmentBackfillArgs(
        [
          '--apply',
          '--reviewed-plan',
          'scratch/reviewed/plan.json',
          '--confirm-digest',
          'a'.repeat(64),
          '--confirm-project',
          projectId,
          '--confirm-database',
          databaseId,
          '--report-dir',
          'scratch/apply-result',
        ],
        cwd
      )
    ).toEqual({
      mode: 'apply',
      applyRollback: false,
      reviewedPlanPath: path.resolve(cwd, 'scratch/reviewed/plan.json'),
      confirmDigest: 'a'.repeat(64),
      confirmProjectId: projectId,
      confirmDatabaseId: databaseId,
      reportDir: path.resolve(cwd, 'scratch/apply-result'),
      help: false,
    });
  });

  it('keeps rollback read-only unless --apply is also present', () => {
    const dry = parseSafeEnrollmentBackfillArgs(
      ['--rollback', '--reviewed-plan', 'plan.json', '--apply-journal', 'journal.json'],
      cwd
    );
    const apply = parseSafeEnrollmentBackfillArgs(
      ['--rollback', '--apply', '--reviewed-plan', 'plan.json', '--apply-journal', 'journal.json'],
      cwd
    );
    expect(dry).toMatchObject({ mode: 'rollback', applyRollback: false });
    expect(apply).toMatchObject({ mode: 'rollback', applyRollback: true });
  });

  it('rejects unknown flags, missing values, and incompatible modes', () => {
    expect(() => parseSafeEnrollmentBackfillArgs(['--unknown'], cwd)).toThrow(
      'Unknown option: --unknown'
    );
    expect(() => parseSafeEnrollmentBackfillArgs(['--report-dir'], cwd)).toThrow(
      'Missing value for --report-dir'
    );
    expect(() => parseSafeEnrollmentBackfillArgs(['--verify', '--rollback'], cwd)).toThrow(
      'SAFE_ENROLLMENT_MODE_CONFLICT'
    );
  });

  it('parses --help without requiring any Firebase option', () => {
    expect(parseSafeEnrollmentBackfillArgs(['--help'], cwd)).toMatchObject({ help: true });
  });
});

describe('safe enrollment runner guards', () => {
  function dependencies(events: string[]): SafeEnrollmentRunnerDependencies {
    const reviewedFile = reviewed();
    return {
      loadSources: async () => {
        events.push('load');
        return {
          sources: {
            students: [
              { id: 'student-1', data: { classId: 'class-1', enrollmentStatus: 'active' } },
            ],
            classes: [{ id: 'class-1', data: { startDate: '2026-08-01', endDate: '2026-08-31' } }],
            existingByStudent: new Map(),
          },
          summary: { students: 1, classes: 1, enrollments: 0 },
        };
      },
      writeReports: async ({ plan, target, reportDir }) => {
        events.push('report');
        return {
          digest: createSafeEnrollmentDigest({ plan, target }),
          reportPath: path.join(reportDir, 'report.json'),
          csvPath: path.join(reportDir, 'report.csv'),
          planPath: path.join(reportDir, 'plan.json'),
          journalPath: path.join(reportDir, 'journal.json'),
        };
      },
      readReviewed: async () => {
        events.push('review');
        return reviewedFile;
      },
      preflight: async () => {
        events.push('preflight');
        return reviewedFile.plan;
      },
      apply: async () => {
        events.push('apply');
        return {
          attempted: 1,
          created: 1,
          conflicted: 0,
          createdDocumentIds: ['enrollment-1'],
          journalSyncFailedDocumentIds: [],
        };
      },
      verify: async () => {
        events.push('verify');
        return {
          valid: true,
          checkedCandidates: 1,
          missingDocumentIds: [],
          mismatchedDocumentIds: [],
          multipleOpenStudentIds: [],
          remainingCandidateStudentIds: [],
        };
      },
      appendJournal: async () => {
        events.push('journal');
      },
      readJournal: async () => [],
      loadDurableJournal: async () => [],
      planRollback: async () => ({ safeToDelete: [], blocked: [] }),
      applyRollback: async () => ({ deleted: 0, conflicted: 0, deletedDocumentIds: [] }),
      verifyRollback: async () => ({ valid: true, checked: 0, remainingDocumentIds: [] }),
    };
  }

  it('runs dry-run as load, plan, and report without apply', async () => {
    const events: string[] = [];
    const result = await runSafeEnrollmentBackfill({
      db: {} as DocumentStore,
      projectId,
      databaseId,
      generatedAt,
      vietnamDate,
      options: parseSafeEnrollmentBackfillArgs([], cwd),
      deps: dependencies(events),
    });
    expect(events).toEqual(['load', 'report']);
    expect(result.mode).toBe('dry-run');
  });

  it('rejects apply before reading DocumentStore when confirmations are missing', async () => {
    const events: string[] = [];
    const options = parseSafeEnrollmentBackfillArgs(['--apply'], cwd);
    await expect(
      runSafeEnrollmentBackfill({
        db: {} as DocumentStore,
        projectId,
        databaseId,
        generatedAt,
        vietnamDate,
        options,
        deps: dependencies(events),
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_CONFIRMATION_REQUIRED');
    expect(events).toEqual([]);
  });

  it('runs reviewed apply in guard order and verifies before success', async () => {
    const events: string[] = [];
    const options = parseSafeEnrollmentBackfillArgs(
      [
        '--apply',
        '--reviewed-plan',
        'scratch/reviewed/plan.json',
        '--confirm-digest',
        reviewed().digest,
        '--confirm-project',
        projectId,
        '--confirm-database',
        databaseId,
        '--report-dir',
        'scratch/apply',
      ],
      cwd
    );
    const result = await runSafeEnrollmentBackfill({
      db: {} as DocumentStore,
      projectId,
      databaseId,
      generatedAt,
      vietnamDate,
      options,
      deps: dependencies(events),
    });
    expect(events).toEqual(['review', 'preflight', 'report', 'apply', 'verify']);
    expect(result).toMatchObject({ mode: 'apply', verification: { valid: true } });
  });

  it('rejects using the reviewed directory as the apply output directory', async () => {
    const reviewedPath = path.resolve(cwd, 'scratch/reviewed/plan.json');
    const options = parseSafeEnrollmentBackfillArgs(
      [
        '--apply',
        '--reviewed-plan',
        reviewedPath,
        '--confirm-digest',
        reviewed().digest,
        '--confirm-project',
        projectId,
        '--confirm-database',
        databaseId,
        '--report-dir',
        path.dirname(reviewedPath),
      ],
      cwd
    );
    await expect(
      runSafeEnrollmentBackfill({
        db: {} as DocumentStore,
        projectId,
        databaseId,
        generatedAt,
        vietnamDate,
        options,
        deps: dependencies([]),
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_APPLY_REPORT_DIR_MUST_DIFFER');
  });
});
