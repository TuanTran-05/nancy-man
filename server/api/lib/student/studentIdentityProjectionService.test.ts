import { beforeEach, describe, expect, it } from 'vitest';
import { rebuildStudentIdentityProjections } from './studentIdentityProjectionService.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { resetCanonicalStudentReadControlCacheForTests } from './canonicalStudentReadControl.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

type Seed = Record<string, Record<string, unknown>>;
const NOW = new Date('2026-08-09T10:00:00.000Z');

function readMode(mode: string): Seed {
  return {
    '_maintenance/student_identity_read_model': {
      schemaVersion: 1,
      mode,
      generation: 5,
      activatedAt: '2026-08-09T09:00:00.000Z',
      activatedBy: 'migration',
      normalizationRunId: 'run-1',
      planDigest: 'p'.repeat(64),
      approvalDigest: 'q'.repeat(64),
    },
  };
}

function profile(id: string): Seed {
  return { [`students/${id}`]: { name: `Học Sinh ${id}`, studentLifecycle: 'enrolled' } };
}

function alias(legacyId: string, canonicalId: string): Seed {
  return {
    [`student_profile_aliases/${legacyId}`]: {
      legacyProfileId: legacyId,
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: 't',
      createdBy: 'merge',
    },
  };
}

function enrollment(profileId: string, classId: string, status = 'active'): Seed {
  const id = makeStudentCourseEnrollmentId(profileId, classId, '2026-07-01');
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart: '2026-07-01',
      termEnd: '2026-12-31',
      status,
      joinedAt: '2026-07-01',
      endedAt: null,
    },
  };
}

describe('rebuildStudentIdentityProjections', () => {
  beforeEach(() => resetCanonicalStudentReadControlCacheForTests());

  it('refuses to run before reads serve canonical_required', async () => {
    // Rebuilding under the old read mode writes the old answer back into the
    // projection and calls it repaired.
    const { db } = createInMemoryDocumentStore({
      ...readMode('canonical_preferred'),
      ...profile('a'),
    });

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: true,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.blockers[0]).toContain('STUDENT_IDENTITY_READ_MODE_NOT_REQUIRED');
    expect(result.applied).toBe(false);
  });

  it('reports the work without doing it when not applying', async () => {
    // This is the command an operator reaches for to find out what a rebuild
    // would do; a dry run that deleted a summary would be a dry run in name.
    const { db, store } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('canonical-1'),
      ...alias('legacy-1', 'canonical-1'),
      'accounting_student_summaries/legacy-1': { studentId: 'legacy-1', sourceVersion: 2 },
    });

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: false,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.summariesPruned).toBe(0);
    expect(result.summariesWritten).toBe(0);
    expect(store.has('accounting_student_summaries/legacy-1')).toBe(true);
  });

  it('prunes a summary written against a retired profile under apply', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('canonical-1'),
      ...profile('legacy-1'),
      ...alias('legacy-1', 'canonical-1'),
      'accounting_student_summaries/legacy-1': { studentId: 'legacy-1', sourceVersion: 2 },
      'accounting_student_summaries/canonical-1': { studentId: 'canonical-1', sourceVersion: 3 },
      'accounting_student_summary_health/current': {
        sourceVersion: 2,
        studentCount: 2,
        summaryCount: 2,
        complete: true,
      },
    });

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: true,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.summariesPruned).toBe(1);
    expect(store.has('accounting_student_summaries/legacy-1')).toBe(false);
    expect(result.valid).toBe(true);
    expect(store.get('accounting_student_summary_health/current')).toMatchObject({
      sourceVersion: 3,
      eligibleCanonicalProfiles: 1,
      physicalStudentDocumentCount: 2,
      summaryCount: 1,
      tombstoneCount: 0,
      repairBacklog: 0,
      complete: true,
    });
    expect(store.get('accounting_student_summary_health/current')?.studentCount).toBeUndefined();
  });

  it('creates the summary a canonical profile was missing', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('canonical-1'),
    });

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: true,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.summariesWritten).toBe(1);
    expect(store.get('accounting_student_summaries/canonical-1')?.sourceVersion).toBe(3);
  });

  it('never writes a monetary figure', async () => {
    // A rebuild that could adjust a balance would be a second, unreviewed
    // migration.
    const { db, store } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('canonical-1'),
    });

    await rebuildStudentIdentityProjections({ db, apply: true, runId: 'run-1', now: NOW });

    const summary = store.get('accounting_student_summaries/canonical-1') || {};
    for (const field of ['balance', 'paidTotal', 'walletBalance', 'netAmount', 'amount']) {
      expect(summary[field]).toBeUndefined();
    }
  });

  it('never changes the maintenance state', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('canonical-1'),
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'run-1',
        migrationActorId: 'migration',
        updatedAt: 't',
        updatedBy: 'operator',
      },
    });

    await rebuildStudentIdentityProjections({ db, apply: true, runId: 'run-1', now: NOW });

    expect(store.get('_maintenance/student_identity')?.mode).toBe('read_only');
  });

  it('counts a class roster from open enrollments and reports a stale stored count', async () => {
    const { db } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('a'),
      ...profile('b'),
      ...enrollment('a', 'class-g7'),
      ...enrollment('b', 'class-g7'),
      ...enrollment('b', 'class-g6', 'completed'),
      'classes/class-g7': { name: 'G7', studentCount: 3 },
      'classes/class-g6': { name: 'G6', studentCount: 0 },
    });

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: true,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.dashboardOpenEnrollments).toBe(2);
    expect(result.classCountMismatches).toEqual(['class-g7']);
    expect(result.valid).toBe(false);
  });

  it('counts a merged child once in the dashboard figures', async () => {
    const { db } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('canonical-1'),
      ...profile('legacy-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('canonical-1', 'class-g7'),
    });

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: true,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.dashboardCanonicalProfiles).toBe(1);
    expect(result.dashboardOpenEnrollments).toBe(1);
  });
});

describe('rebuildStudentIdentityProjections evidence and source failures', () => {
  beforeEach(() => resetCanonicalStudentReadControlCacheForTests());

  it('records immutable evidence the release gate can name', async () => {
    // The exit gate reads student_identity_projection_rebuilds/{id}. Without a
    // writer, a verified cutover could never be proven at all.
    const { db, store } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('a'),
      'accounting_student_summaries/a': { studentId: 'a', sourceVersion: 3 },
    });

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: true,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.valid).toBe(true);
    expect(result.evidenceId).toBeTruthy();
    expect(store.get(`student_identity_projection_rebuilds/${result.evidenceId}`)).toMatchObject({
      runId: 'run-1',
      status: 'valid',
      missingCount: 0,
      staleCount: 0,
    });
  });

  it('refuses to overwrite evidence already recorded for a run', async () => {
    const seed = {
      ...readMode('canonical_required'),
      ...profile('a'),
      'accounting_student_summaries/a': { studentId: 'a', sourceVersion: 3 },
    };
    const { db } = createInMemoryDocumentStore(seed);
    const first = await rebuildStudentIdentityProjections({ db, apply: true, runId: 'run-1', now: NOW });

    await expect(
      rebuildStudentIdentityProjections({ db, apply: true, runId: 'run-1', now: NOW })
    ).rejects.toThrow('STUDENT_IDENTITY_REBUILD_EVIDENCE_IMMUTABLE');
    expect(first.evidenceId).toBeTruthy();
  });

  it('blocks instead of treating an unreadable collection as empty', async () => {
    const { db } = createInMemoryDocumentStore({
      ...readMode('canonical_required'),
      ...profile('a'),
    });
    const mutable = db as never as { collection: (name: string) => unknown };
    const readable = mutable.collection.bind(mutable);
    mutable.collection = (name: string) => {
      if (name === 'student_profile_aliases') throw new Error('unavailable');
      return readable(name) as never;
    };

    const result = await rebuildStudentIdentityProjections({
      db,
      apply: false,
      runId: 'run-1',
      now: NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.blockers.join(' ')).toContain('STUDENT_IDENTITY_PROJECTION_SOURCE_UNAVAILABLE');
  });
});
