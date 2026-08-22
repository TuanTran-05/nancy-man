import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parseCourseClosingBackfillArgs,
  runCourseClosingRecordBackfill,
} from './backfill-course-closing-records.js';

const PROJECT_ID = 'gen-lang-client-0014842483';
const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const target = { projectId: PROJECT_ID, databaseId: DATABASE_ID };

function emptyPlan() {
  return {
    generatedAt: '2026-07-25T09:00:00.000Z',
    items: [],
    summary: { create: 0, merge: 0, unchanged: 0, ambiguous: 0, skipped: 0 },
  };
}

function sourceCounts() {
  return {
    classes: 0,
    students: 0,
    evaluations: 0,
    notifications: 0,
    ledgers: 0,
    enrollments: 0,
    users: 0,
    existingRecords: 0,
  };
}

function manifest() {
  return {
    generatedAt: '2026-07-25T09:00:00.000Z',
    digest: 'digest-1',
    target,
    jsonPath: 'report.json',
    csvPath: 'report.csv',
    planPath: 'plan.json',
    summary: emptyPlan().summary,
    sourceCounts: sourceCounts(),
  };
}

describe('course-closing backfill CLI', () => {
  it('defaults to dry-run and scratch report output', () => {
    expect(parseCourseClosingBackfillArgs([], 'C:\\repo')).toEqual({
      apply: false,
      reportDir: path.resolve('C:\\repo', 'scratch', 'course-closing-record-backfill'),
      confirmProjectId: undefined,
      confirmDatabaseId: undefined,
      reviewedPlanPath: undefined,
      confirmDigest: undefined,
      help: false,
    });
  });

  it('parses explicit apply confirmations', () => {
    expect(
      parseCourseClosingBackfillArgs(
        [
          '--apply',
          '--confirm-project',
          PROJECT_ID,
          '--confirm-database',
          DATABASE_ID,
          '--reviewed-plan',
          'scratch\\reviewed\\course-closing-backfill-plan.json',
          '--confirm-digest',
          'digest-1',
          '--report-dir',
          'scratch\\preview',
        ],
        'C:\\repo'
      )
    ).toMatchObject({
      apply: true,
      confirmProjectId: PROJECT_ID,
      confirmDatabaseId: DATABASE_ID,
      reviewedPlanPath: path.resolve(
        'C:\\repo',
        'scratch\\reviewed\\course-closing-backfill-plan.json'
      ),
      confirmDigest: 'digest-1',
      reportDir: path.resolve('C:\\repo', 'scratch\\preview'),
    });
  });

  it('writes reports and never calls apply in default mode', async () => {
    const apply = vi.fn();
    const writeReports = vi.fn(async () => manifest());

    const result = await runCourseClosingRecordBackfill({
      db: {} as never,
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      generatedAt: '2026-07-25T09:00:00.000Z',
      options: parseCourseClosingBackfillArgs([], 'C:\\repo'),
      deps: {
        loadSources: vi.fn(async () => ({
          sources: {
            classes: [],
            students: [],
            evaluations: [],
            notifications: [],
            ledgers: [],
            enrollments: [],
            users: [],
            existingRecords: [],
            existingRecordVersions: {},
          },
          summary: sourceCounts(),
        })),
        plan: vi.fn(() => emptyPlan()),
        writeReports,
        readReviewed: vi.fn(),
        apply,
      },
    });

    expect(writeReports).toHaveBeenCalledOnce();
    expect(writeReports).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
      })
    );
    expect(apply).not.toHaveBeenCalled();
    expect(result).toEqual({ manifest: manifest() });
  });

  it('creates the report before entering explicit apply', async () => {
    const events: string[] = [];

    await runCourseClosingRecordBackfill({
      db: {} as never,
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      generatedAt: '2026-07-25T09:00:00.000Z',
      options: parseCourseClosingBackfillArgs(
        [
          '--apply',
          '--confirm-project',
          PROJECT_ID,
          '--confirm-database',
          DATABASE_ID,
          '--reviewed-plan',
          'reviewed-plan.json',
          '--confirm-digest',
          'digest-1',
        ],
        'C:\\repo'
      ),
      deps: {
        loadSources: vi.fn(async () => ({
          sources: {
            classes: [],
            students: [],
            evaluations: [],
            notifications: [],
            ledgers: [],
            enrollments: [],
            users: [],
            existingRecords: [],
            existingRecordVersions: {},
          },
          summary: sourceCounts(),
        })),
        plan: vi.fn(() => emptyPlan()),
        writeReports: vi.fn(async () => {
          events.push('report');
          return manifest();
        }),
        readReviewed: vi.fn(async () => {
          events.push('reviewed');
          return {
            digest: 'digest-1',
            target,
            sourceCounts: sourceCounts(),
            plan: emptyPlan(),
          };
        }),
        apply: vi.fn(async () => {
          events.push('apply');
          return { created: 0, merged: 0, unchanged: 0, conflicted: 0 };
        }),
      },
    });

    expect(events).toEqual(['reviewed', 'report', 'apply']);
  });

  it('refuses apply when the current plan digest differs from the reviewed plan', async () => {
    await expect(
      runCourseClosingRecordBackfill({
        db: {} as never,
        projectId: PROJECT_ID,
        databaseId: DATABASE_ID,
        generatedAt: '2026-07-25T10:00:00.000Z',
        options: parseCourseClosingBackfillArgs(
          [
            '--apply',
            '--confirm-project',
            PROJECT_ID,
            '--confirm-database',
            DATABASE_ID,
            '--reviewed-plan',
            'reviewed-plan.json',
            '--confirm-digest',
            'digest-1',
          ],
          'C:\\repo'
        ),
        deps: {
          loadSources: vi.fn(async () => ({
            sources: {
              classes: [],
              students: [],
              evaluations: [],
              notifications: [],
              ledgers: [],
              enrollments: [],
              users: [],
              existingRecords: [],
              existingRecordVersions: {},
            },
            summary: sourceCounts(),
          })),
          plan: vi.fn(() => emptyPlan()),
          writeReports: vi.fn(async () => ({
            ...manifest(),
            digest: 'current-digest',
          })),
          readReviewed: vi.fn(async () => ({
            digest: 'digest-1',
            target,
            sourceCounts: sourceCounts(),
            plan: emptyPlan(),
          })),
          apply: vi.fn(),
        },
      })
    ).rejects.toThrow('BACKFILL_REVIEWED_PLAN_CHANGED');
  });

  it('refuses to overwrite the reviewed dry-run directory during apply', async () => {
    const reviewedPlanPath = path.resolve(
      'C:\\repo',
      'scratch\\reviewed\\course-closing-backfill-plan.json'
    );
    const options = parseCourseClosingBackfillArgs(
      [
        '--apply',
        '--confirm-project',
        PROJECT_ID,
        '--confirm-database',
        DATABASE_ID,
        '--reviewed-plan',
        reviewedPlanPath,
        '--confirm-digest',
        'digest-1',
        '--report-dir',
        path.dirname(reviewedPlanPath),
      ],
      'C:\\repo'
    );

    await expect(
      runCourseClosingRecordBackfill({
        db: {} as never,
        projectId: PROJECT_ID,
        databaseId: DATABASE_ID,
        generatedAt: '2026-07-25T10:00:00.000Z',
        options,
        deps: {
          loadSources: vi.fn(),
          plan: vi.fn(),
          writeReports: vi.fn(),
          readReviewed: vi.fn(async () => ({
            digest: 'digest-1',
            target,
            sourceCounts: sourceCounts(),
            plan: emptyPlan(),
          })),
          apply: vi.fn(),
        },
      })
    ).rejects.toThrow('BACKFILL_APPLY_REPORT_DIR_MUST_DIFFER');
  });
});
