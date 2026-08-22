import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../shared/courseClosingRecords.js';
import {
  parseMaterializationArgs,
  runCourseClosingMaterialization,
} from './materialize-course-closing-documents.js';
import { planCourseClosingMaterialization } from './course-closing-materialization/planner.js';
import {
  readReviewedMaterializationPlan,
  writeMaterializationReports,
} from './course-closing-materialization/reporter.js';
import { inspectCourseClosingStorage } from './course-closing-materialization/storageSources.js';

const cwd = 'C:/repo';
const generatedAt = '2026-07-27T00:00:00.000Z';

function recordFixture(id = 'c1__s1'): CourseClosingRecord {
  return {
    id,
    recordVersion: 1,
    closingMonth: '2026-07',
    courseId: `course-${id}`,
    classId: 'class-1',
    className: 'Class 1',
    classNameNormalized: 'class 1',
    courseStartDate: '2026-03-01',
    courseEndDate: '2026-07-01',
    studentId: `student-${id}`,
    studentName: 'Student 1',
    studentNameNormalized: 'student 1',
    studentCode: 'HS001',
    teacherId: 'teacher-1',
    teacherName: 'Teacher 1',
    evaluationDocument: {
      type: 'evaluation',
      status: 'not_requested',
      templateVersion: 1,
      mimeType: COURSE_CLOSING_DOCX_MIME,
      attempts: 0,
    },
    tuitionDocument: {
      type: 'tuition',
      status: 'not_requested',
      templateVersion: 1,
      mimeType: COURSE_CLOSING_DOCX_MIME,
      attempts: 0,
    },
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
  };
}

function sourceFixture(records = [recordFixture()]) {
  return { records, notifications: [], ledgers: [] };
}

async function tempDir(prefix: string) {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

function deps(overrides: Record<string, any> = {}) {
  const loadSources = vi.fn(async () => sourceFixture());
  const inspectStorage = vi.fn(async (records: CourseClosingRecord[]) =>
    inspectCourseClosingStorage(records, async () => false)
  );
  const plan = vi.fn(planCourseClosingMaterialization);
  return {
    loadSources,
    inspectStorage,
    plan,
    writeReports: writeMaterializationReports,
    readReviewed: readReviewedMaterializationPlan,
    apply: vi.fn(async () => ({
      materialized: 2,
      unchanged_ready: 0,
      repaired_ready_status: 0,
      conflicted: 0,
      failed: 0,
      results: [],
    })),
    verify: vi.fn(async () => ({
      ready_with_file: 2,
      metadata_missing: 0,
      file_missing: 0,
      results: [],
    })),
    fileExists: async () => true,
    preflight: vi.fn(async () => {}),
    ...overrides,
  } as any;
}

describe('parseMaterializationArgs', () => {
  it('defaults to a dry run and parses every guarded apply flag', () => {
    expect(parseMaterializationArgs([], cwd)).toMatchObject({ apply: false, help: false });
    const options = parseMaterializationArgs(
      [
        '--apply',
        '--confirm-project',
        'proj',
        '--confirm-database',
        'db',
        '--reviewed-plan',
        'reviewed/plan.json',
        '--confirm-digest',
        'abc123',
        '--report-dir',
        'out',
      ],
      cwd
    );

    expect(options).toMatchObject({
      apply: true,
      confirmProjectId: 'proj',
      confirmDatabaseId: 'db',
      confirmDigest: 'abc123',
    });
    expect(options.reviewedPlanPath).toBe(path.resolve(cwd, 'reviewed/plan.json'));
    expect(options.reportDir).toBe(path.resolve(cwd, 'out'));
  });

  it('rejects unknown options and missing values', () => {
    expect(() => parseMaterializationArgs(['--nope'], cwd)).toThrow('Unknown option: --nope');
    expect(() => parseMaterializationArgs(['--confirm-project'], cwd)).toThrow(
      'Missing value for --confirm-project'
    );
  });
});

describe('runCourseClosingMaterialization', () => {
  it('loads evidence, inspects Storage, and writes a complete dry-run plan', async () => {
    const reportDir = await tempDir('ccm-dry-');
    const d = deps();
    const result = await runCourseClosingMaterialization({
      db: {} as any,
      projectId: 'proj',
      databaseId: 'db',
      options: parseMaterializationArgs(['--report-dir', reportDir], cwd),
      generatedAt,
      deps: d,
    });

    expect(result.manifest.summary.total).toBe(2);
    expect(d.loadSources).toHaveBeenCalledOnce();
    expect(d.inspectStorage).toHaveBeenCalledOnce();
    expect(d.plan).toHaveBeenCalledWith(
      expect.objectContaining({ records: expect.any(Array) }),
      expect.any(Array),
      generatedAt
    );
    expect(d.apply).not.toHaveBeenCalled();
    expect(d.verify).not.toHaveBeenCalled();
  });

  it('refuses apply without a reviewed plan and separate output directory', async () => {
    const reportDir = await tempDir('ccm-noplan-');
    await expect(
      runCourseClosingMaterialization({
        db: {} as any,
        projectId: 'proj',
        databaseId: 'db',
        options: parseMaterializationArgs(
          [
            '--apply',
            '--confirm-project',
            'proj',
            '--confirm-database',
            'db',
            '--report-dir',
            reportDir,
          ],
          cwd
        ),
        generatedAt,
        deps: deps(),
      })
    ).rejects.toThrow('MATERIALIZE_REVIEWED_PLAN_REQUIRED');

    const d = deps();
    const dryRun = await runCourseClosingMaterialization({
      db: {} as any,
      projectId: 'proj',
      databaseId: 'db',
      options: parseMaterializationArgs(['--report-dir', reportDir], cwd),
      generatedAt,
      deps: d,
    });
    await expect(
      runCourseClosingMaterialization({
        db: {} as any,
        projectId: 'proj',
        databaseId: 'db',
        options: parseMaterializationArgs(
          [
            '--apply',
            '--confirm-project',
            'proj',
            '--confirm-database',
            'db',
            '--reviewed-plan',
            dryRun.manifest.planPath,
            '--confirm-digest',
            dryRun.manifest.digest,
            '--report-dir',
            reportDir,
          ],
          cwd
        ),
        generatedAt,
        deps: d,
      })
    ).rejects.toThrow('MATERIALIZE_APPLY_REPORT_DIR_MUST_DIFFER');
  });

  it('applies and verifies when the reviewed source and Storage state are unchanged', async () => {
    const reviewDir = await tempDir('ccm-review-');
    const applyDir = await tempDir('ccm-apply-');
    const d = deps();
    const dryRun = await runCourseClosingMaterialization({
      db: {} as any,
      projectId: 'proj',
      databaseId: 'db',
      options: parseMaterializationArgs(['--report-dir', reviewDir], cwd),
      generatedAt,
      deps: d,
    });
    const applied = await runCourseClosingMaterialization({
      db: {} as any,
      projectId: 'proj',
      databaseId: 'db',
      options: parseMaterializationArgs(
        [
          '--apply',
          '--confirm-project',
          'proj',
          '--confirm-database',
          'db',
          '--reviewed-plan',
          dryRun.manifest.planPath,
          '--confirm-digest',
          dryRun.manifest.digest,
          '--report-dir',
          applyDir,
        ],
        cwd
      ),
      generatedAt: '2026-07-27T09:00:00.000Z',
      deps: d,
    });

    expect(d.apply).toHaveBeenCalledOnce();
    expect(applied.applySummary?.materialized).toBe(2);
    expect(applied.verification?.ready_with_file).toBe(2);
    expect(d.apply.mock.calls[0][3]).toMatchObject({ fileExists: d.fileExists });
  });

  it('aborts before writes when preflight fails or a conflict is planned', async () => {
    const reviewDir = await tempDir('ccm-blocked-review-');
    const applyDir = await tempDir('ccm-blocked-apply-');
    const invalid = recordFixture();
    invalid.courseId = '';
    const blockedDeps = deps({
      loadSources: vi.fn(async () => sourceFixture([invalid])),
    });
    const dryRun = await runCourseClosingMaterialization({
      db: {} as any,
      projectId: 'proj',
      databaseId: 'db',
      options: parseMaterializationArgs(['--report-dir', reviewDir], cwd),
      generatedAt,
      deps: blockedDeps,
    });

    await expect(
      runCourseClosingMaterialization({
        db: {} as any,
        projectId: 'proj',
        databaseId: 'db',
        options: parseMaterializationArgs(
          [
            '--apply',
            '--confirm-project',
            'proj',
            '--confirm-database',
            'db',
            '--reviewed-plan',
            dryRun.manifest.planPath,
            '--confirm-digest',
            dryRun.manifest.digest,
            '--report-dir',
            applyDir,
          ],
          cwd
        ),
        generatedAt,
        deps: blockedDeps,
      })
    ).rejects.toThrow('MATERIALIZE_PLAN_BLOCKED_BY_CONFLICT');
    expect(blockedDeps.preflight).not.toHaveBeenCalled();
    expect(blockedDeps.apply).not.toHaveBeenCalled();

    const valid = deps({
      preflight: vi.fn(async () => {
        throw new Error('MATERIALIZE_STORAGE_BUCKET_UNREACHABLE');
      }),
    });
    const validReviewDir = await tempDir('ccm-preflight-review-');
    const validApplyDir = await tempDir('ccm-preflight-apply-');
    const validDry = await runCourseClosingMaterialization({
      db: {} as any,
      projectId: 'proj',
      databaseId: 'db',
      options: parseMaterializationArgs(['--report-dir', validReviewDir], cwd),
      generatedAt,
      deps: valid,
    });
    await expect(
      runCourseClosingMaterialization({
        db: {} as any,
        projectId: 'proj',
        databaseId: 'db',
        options: parseMaterializationArgs(
          [
            '--apply',
            '--confirm-project',
            'proj',
            '--confirm-database',
            'db',
            '--reviewed-plan',
            validDry.manifest.planPath,
            '--confirm-digest',
            validDry.manifest.digest,
            '--report-dir',
            validApplyDir,
          ],
          cwd
        ),
        generatedAt,
        deps: valid,
      })
    ).rejects.toThrow('MATERIALIZE_STORAGE_BUCKET_UNREACHABLE');
    expect(valid.apply).not.toHaveBeenCalled();
  });

  it('aborts when production drift changes the reviewed digest', async () => {
    const reviewDir = await tempDir('ccm-drift-review-');
    const applyDir = await tempDir('ccm-drift-apply-');
    const d = deps();
    const dryRun = await runCourseClosingMaterialization({
      db: {} as any,
      projectId: 'proj',
      databaseId: 'db',
      options: parseMaterializationArgs(['--report-dir', reviewDir], cwd),
      generatedAt,
      deps: d,
    });
    d.loadSources.mockResolvedValue(sourceFixture([recordFixture(), recordFixture('c1__s2')]));

    await expect(
      runCourseClosingMaterialization({
        db: {} as any,
        projectId: 'proj',
        databaseId: 'db',
        options: parseMaterializationArgs(
          [
            '--apply',
            '--confirm-project',
            'proj',
            '--confirm-database',
            'db',
            '--reviewed-plan',
            dryRun.manifest.planPath,
            '--confirm-digest',
            dryRun.manifest.digest,
            '--report-dir',
            applyDir,
          ],
          cwd
        ),
        generatedAt: '2026-07-27T09:00:00.000Z',
        deps: d,
      })
    ).rejects.toThrow('MATERIALIZE_REVIEWED_PLAN_CHANGED');
    expect(d.apply).not.toHaveBeenCalled();
  });
});
