import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAcademicReportsMonthly, readAccountingStudents, readStudents } from './readers.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import {
  resetCanonicalStudentReadControlCacheForTests,
  STUDENT_IDENTITY_READ_MODEL_PATH,
} from '../../lib/student/canonicalStudentReadControl.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { flushDeferredReadTelemetry } from '../../lib/telemetry/deferredReadTelemetry.js';
import type { UserContext } from '../../lib/auth/authz.js';

type Seed = Record<string, Record<string, unknown>>;

function control(mode: string): Seed {
  return {
    [STUDENT_IDENTITY_READ_MODEL_PATH]: {
      schemaVersion: 1,
      mode,
      generation: 1,
      activatedAt: '2026-08-08T00:00:00.000Z',
      activatedBy: 'admin:tt',
      normalizationRunId: null,
      planDigest: null,
      approvalDigest: null,
    },
  };
}

function enrollment(
  profileId: string,
  classId: string,
  termStart: string,
  status: string
): Seed {
  const id = makeStudentCourseEnrollmentId(profileId, classId, termStart);
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart,
      termEnd: '2026-12-31',
      status,
      joinedAt: termStart,
      endedAt: ['completed', 'transferred', 'dropped'].includes(status) ? '2026-12-31' : null,
      source: 'system',
      confidence: 'confirmed',
    },
  };
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

const CLASSES: Seed = {
  'classes/class-g6': { name: 'G6', teacherId: 'teacher-1', status: 'active' },
  'classes/class-g7': { name: 'G7', teacherId: 'teacher-2', status: 'active' },
};

/**
 * The production shape this workstream exists for: one human with a retired
 * G6 profile still stamped `promoted` and a live G7 profile. The legacy read
 * returns both rows; there is one child.
 */
function duplicateHumanSeed(): Seed {
  return {
    ...CLASSES,
    ...control('legacy_compare'),
    'students/canonical-1': {
      name: 'Quách Hoàng Minh',
      studentId: 'HS260167',
      dob: '2014-05-02',
      // Deliberately stale, and deliberately disagreeing with the enrollment.
      classId: 'class-g6',
      teacherId: 'teacher-1',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    },
    'students/legacy-1': {
      name: 'Quách Hoàng Minh',
      studentId: 'HS260167',
      dob: '2014-05-02',
      classId: 'class-g6',
      teacherId: 'teacher-1',
      enrollmentStatus: 'promoted',
      studentLifecycle: 'enrolled',
    },
    ...alias('legacy-1', 'canonical-1'),
    ...enrollment('legacy-1', 'class-g6', '2026-01-05', 'completed'),
    ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
  };
}

function withMode(seed: Seed, mode: string): Seed {
  return { ...seed, ...control(mode) };
}

const ADMIN: UserContext = { uid: 'admin-1', role: 'admin', name: 'Admin' };

function request(query: Record<string, string> = {}) {
  return { query } as never;
}

type StudentRow = Record<string, unknown>;
function rowsOf(result: unknown): StudentRow[] {
  return (result as { students: StudentRow[] }).students;
}

describe('readStudents in legacy_compare', () => {
  beforeEach(() => {
    resetCanonicalStudentReadControlCacheForTests();
    vi.restoreAllMocks();
  });

  it('returns the legacy answer unchanged, duplicates and all', async () => {
    // Shadow mode changes nothing a client can see. Anything else would make
    // the comparison a test of the new code against itself.
    const { db } = createInMemoryDocumentStore(duplicateHumanSeed());

    const rows = rowsOf(await readStudents(db, ADMIN, request({ view: 'directory' })));

    expect(rows.map((row) => row.id).sort()).toEqual(['canonical-1', 'legacy-1']);
    expect(rows[0]).not.toHaveProperty('canonicalProfileId');
    expect(rows[0]).not.toHaveProperty('placementStatus');
  });

  it('answers the caller before the comparison has read anything', async () => {
    // The comparison is telemetry: nothing in the response depends on it, and
    // it costs roughly four reads per student. Charging the page for it is how
    // a 250 ms query became a five second one.
    const { db, readLog } = createInMemoryDocumentStore(duplicateHumanSeed());
    const logged: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await readStudents(db, ADMIN, request({ view: 'directory' }));

    // The answer is ready while the comparison is still mid-flight.
    expect(logged.filter((line) => line.includes('canonical-read-discrepancy'))).toEqual([]);

    // Deferred, not dropped: the evidence still arrives, after the response.
    await flushDeferredReadTelemetry();

    expect(readLog).toContain('student_profile_aliases/legacy-1');
    expect(logged.filter((line) => line.includes('canonical-read-discrepancy'))).toHaveLength(1);
  });

  it('records the duplicate as a discrepancy without naming the human', async () => {
    const { db } = createInMemoryDocumentStore(duplicateHumanSeed());
    const logged: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await readStudents(db, ADMIN, request({ view: 'directory' }));
    await flushDeferredReadTelemetry();

    const discrepancies = logged.filter((line) => line.includes('canonical-read-discrepancy'));
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]).toContain('LEGACY_PHYSICAL_DUPLICATE');
    expect(discrepancies[0]).toContain('canonical-1');
    // No name, no date of birth, no contact reaches a log line.
    expect(discrepancies[0]).not.toContain('Quách');
    expect(discrepancies[0]).not.toContain('2014-05-02');
  });

  it('resolves each id once for the comparison, not once per comparison step', async () => {
    // The comparison runs inside the request on the mode production serves
    // first, so resolving the same id twice is a read per student added to
    // every list page for nothing.
    const { db, readLog } = createInMemoryDocumentStore(duplicateHumanSeed());

    await readStudents(db, ADMIN, request({ view: 'directory' }));
    await flushDeferredReadTelemetry();

    expect(readLog.filter((entry) => entry === 'student_profile_aliases/legacy-1')).toHaveLength(1);
  });

  it('logs nothing when the legacy and canonical answers already agree', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...control('legacy_compare'),
      'students/canonical-1': {
        name: 'Một Mình',
        classId: 'class-g7',
        teacherId: 'teacher-2',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });
    const logged: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await readStudents(db, ADMIN, request({ view: 'directory' }));
    await flushDeferredReadTelemetry();

    expect(logged.filter((line) => line.includes('canonical-read-discrepancy'))).toEqual([]);
  });
});

describe('readStudents in canonical_preferred', () => {
  beforeEach(() => {
    resetCanonicalStudentReadControlCacheForTests();
    vi.restoreAllMocks();
  });

  it('returns one row for the human the legacy answer returned twice', async () => {
    const { db } = createInMemoryDocumentStore(
      withMode(duplicateHumanSeed(), 'canonical_preferred')
    );

    const rows = rowsOf(await readStudents(db, ADMIN, request({ view: 'directory' })));

    expect(rows.map((row) => row.id)).toEqual(['canonical-1']);
  });

  it('derives the deprecated class, teacher, and status fields from the enrollment', async () => {
    // The profile says G6/teacher-1/active. The enrollment says G7. Old
    // clients still read the deprecated fields, so they keep working — but
    // they now carry the answer the enrollment gives.
    const { db } = createInMemoryDocumentStore(
      withMode(duplicateHumanSeed(), 'canonical_preferred')
    );

    const [row] = rowsOf(await readStudents(db, ADMIN, request({ view: 'directory' })));

    expect(row).toMatchObject({
      classId: 'class-g7',
      teacherId: 'teacher-2',
      enrollmentStatus: 'active',
      canonicalProfileId: 'canonical-1',
      placementStatus: 'studying',
    });
  });

  it('reports a finished course as waiting for placement, never as promoted', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...control('canonical_preferred'),
      'students/canonical-1': {
        name: 'Đã Xong',
        classId: 'class-g6',
        enrollmentStatus: 'promoted',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('canonical-1', 'class-g6', '2026-01-05', 'completed'),
    });

    const [row] = rowsOf(await readStudents(db, ADMIN, request({ view: 'directory' })));

    expect(row.placementStatus).toBe('waiting_for_placement');
    expect(row.classId).toBe('');
  });

  it('filters a class by enrollment, so a stale profile classId adds nobody', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...control('canonical_preferred'),
      'students/impostor': {
        name: 'Ế Ẩm',
        classId: 'class-g7',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('impostor', 'class-g6', '2026-07-01', 'active'),
      'students/real': { name: 'Thật', studentLifecycle: 'enrolled' },
      ...enrollment('real', 'class-g7', '2026-07-01', 'active'),
    });

    const rows = rowsOf(
      await readStudents(db, ADMIN, request({ view: 'directory', classId: 'class-g7' }))
    );

    expect(rows.map((row) => row.id)).toEqual(['real']);
  });

  it('scopes a teacher to the students enrolled in the classes they teach', async () => {
    // The legacy scope was students.teacherId, a projection that goes stale the
    // moment a student moves. The class is what a teacher actually owns.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...control('canonical_preferred'),
      'students/mine': { name: 'Của Tôi', teacherId: 'nobody', studentLifecycle: 'enrolled' },
      ...enrollment('mine', 'class-g7', '2026-07-01', 'active'),
      'students/theirs': { name: 'Lớp Khác', teacherId: 'teacher-2', studentLifecycle: 'enrolled' },
      ...enrollment('theirs', 'class-g6', '2026-07-01', 'active'),
    });

    const rows = rowsOf(
      await readStudents(
        db,
        { uid: 'teacher-2', role: 'teacher', name: 'Cô Hai' },
        request({ view: 'academic' })
      )
    );

    expect(rows.map((row) => row.id)).toEqual(['mine']);
  });

  it('finishes one teacher class roster before starting the next roster fan-out', async () => {
    const { db, queryLog } = createInMemoryDocumentStore({
      ...CLASSES,
      'classes/class-g8': { name: 'G8', teacherId: 'teacher-2', status: 'active' },
      ...control('canonical_preferred'),
      'students/first': { name: 'First', studentLifecycle: 'enrolled' },
      ...enrollment('first', 'class-g7', '2026-07-01', 'active'),
      'students/second': { name: 'Second', studentLifecycle: 'enrolled' },
      ...enrollment('second', 'class-g8', '2026-07-01', 'active'),
    });

    await readStudents(
      db,
      { uid: 'teacher-2', role: 'teacher', name: 'Teacher Two' },
      request({ view: 'academic' })
    );

    const enrollmentQueries = queryLog.filter(
      (entry) => entry.collection === 'student_course_enrollments'
    );
    const secondRosterIndex = enrollmentQueries.findIndex((entry) =>
      entry.filters.some(
        ([field, operator, value]) =>
          field === 'classId' && operator === '==' && value === 'class-g8'
      )
    );
    const firstStudentFanOutIndex = enrollmentQueries.findIndex((entry) =>
      entry.filters.some(
        ([field, operator, value]) =>
          field === 'studentId' && operator === '==' && value === 'first'
      )
    );

    expect(firstStudentFanOutIndex).toBeGreaterThanOrEqual(0);
    expect(secondRosterIndex).toBeGreaterThan(firstStudentFanOutIndex);
  });

  it('omits a profile whose situation cannot be derived and keeps serving the rest', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...control('canonical_preferred'),
      'students/ok': { name: 'Ổn', studentLifecycle: 'enrolled' },
      ...enrollment('ok', 'class-g7', '2026-07-01', 'active'),
      'students/no-enrollment': { name: 'Không Có Lớp', studentLifecycle: 'enrolled' },
    });

    const rows = rowsOf(await readStudents(db, ADMIN, request({ view: 'directory' })));

    expect(rows.map((row) => row.id)).toEqual(['ok']);
  });
});

describe('readAcademicReportsMonthly', () => {
  beforeEach(() => {
    resetCanonicalStudentReadControlCacheForTests();
    vi.restoreAllMocks();
  });

  it('counts an aliased human once even when the retired profile is still stamped active', async () => {
    const seed = withMode(duplicateHumanSeed(), 'canonical_preferred');
    seed['students/legacy-1'] = {
      ...seed['students/legacy-1'],
      // This stale projection is the production failure mode: a physical read
      // treats both profiles as current even though the alias says one human.
      enrollmentStatus: 'active',
    };
    const { db } = createInMemoryDocumentStore(seed);

    const result = await readAcademicReportsMonthly(
      db,
      ADMIN,
      request({ limit: '2000' }),
      '2099-01'
    );
    const rows = rowsOf(result);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'canonical-1',
      canonicalProfileId: 'canonical-1',
      classId: 'class-g7',
      placementStatus: 'studying',
    });
  });
});

describe('readAccountingStudents', () => {
  beforeEach(() => {
    resetCanonicalStudentReadControlCacheForTests();
    vi.restoreAllMocks();
  });

  function financeSeed(mode: string): Seed {
    return {
      ...withMode(duplicateHumanSeed(), mode),
      // Money is attached to the surviving profile. The retired one carries a
      // ledger from the course it finished.
      'course_fee_ledgers/ledger-new': {
        studentId: 'canonical-1',
        classId: 'class-g7',
        amount: 1_000_000,
        paidTotal: 400_000,
        discountTotal: 0,
        status: 'partial',
      },
    };
  }

  it('lists a merged human once, so their money is not split across two rows', async () => {
    // Two rows for one child is the incident: each shows part of the balance,
    // and whichever one an operator opens looks like the whole story.
    const { db } = createInMemoryDocumentStore(financeSeed('canonical_preferred'));

    const result = (await readAccountingStudents(
      db,
      { uid: 'acc-1', role: 'accounting', name: 'KT' },
      request()
    )) as { students: StudentRow[]; ledgers: Array<Record<string, unknown>> };

    expect(result.students.map((student) => student.id)).toEqual(['canonical-1']);
    expect(result.ledgers.map((ledger) => ledger.id)).toEqual(['ledger-new']);
  });

  it('keeps returning both physical rows in legacy_compare', async () => {
    const { db } = createInMemoryDocumentStore(financeSeed('legacy_compare'));

    const result = (await readAccountingStudents(
      db,
      { uid: 'acc-1', role: 'accounting', name: 'KT' },
      request()
    )) as { students: StudentRow[] };

    expect(result.students.map((student) => student.id).sort()).toEqual([
      'canonical-1',
      'legacy-1',
    ]);
  });

  it('still pulls a sibling onto the page so a family is priced together', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...control('canonical_preferred'),
      'students/child-a': {
        name: 'Anh Cả',
        siblingGroupId: 'sib_1',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('child-a', 'class-g7', '2026-07-01', 'active'),
      'students/child-b': {
        name: 'Em Út',
        siblingGroupId: 'sib_1',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('child-b', 'class-g6', '2026-07-01', 'active'),
    });

    const result = (await readAccountingStudents(
      db,
      { uid: 'acc-1', role: 'accounting', name: 'KT' },
      request({ classId: 'class-g7' })
    )) as { students: StudentRow[] };

    expect(result.students.map((student) => student.id).sort()).toEqual(['child-a', 'child-b']);
  });
});

describe('readStudents in canonical_required', () => {
  beforeEach(() => {
    resetCanonicalStudentReadControlCacheForTests();
    vi.restoreAllMocks();
  });

  it('refuses the page rather than quietly omitting an underivable profile', async () => {
    // Required mode is the point at which the enrollment is the only answer.
    // A profile it cannot answer for is an invariant failure, not a row to
    // drop: dropping it is how a student disappears from a roster silently.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...control('canonical_required'),
      'students/ok': { name: 'Ổn', studentLifecycle: 'enrolled' },
      ...enrollment('ok', 'class-g7', '2026-07-01', 'active'),
      'students/no-enrollment': { name: 'Không Có Lớp', studentLifecycle: 'enrolled' },
    });

    await expect(readStudents(db, ADMIN, request({ view: 'directory' }))).rejects.toThrow(
      'CANONICAL_STUDENT_READ_INVARIANT'
    );
  });

  it('serves the canonical answer when every profile is derivable', async () => {
    const { db } = createInMemoryDocumentStore(
      withMode(duplicateHumanSeed(), 'canonical_required')
    );

    const rows = rowsOf(await readStudents(db, ADMIN, request({ view: 'directory' })));

    expect(rows.map((row) => row.id)).toEqual(['canonical-1']);
    expect(rows[0]).toMatchObject({ classId: 'class-g7', placementStatus: 'studying' });
  });
});
