import { describe, expect, it } from 'vitest';
import {
  collectCanonicalStudentDirectoryProjection,
  readCanonicalDirectoryCounts,
  compareCanonicalStudentReadSets,
  listCanonicalClassRoster,
  listCanonicalStudentDirectory,
  readCanonicalStudentContext,
  readCanonicalStudentsByIds,
  type CanonicalStudentReadAnomaly,
} from './canonicalStudentReadRepository.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

function enrollment(
  profileId: string,
  classId: string,
  termStart: string,
  status: string,
  overrides: Record<string, unknown> = {}
) {
  const id = makeStudentCourseEnrollmentId(profileId, classId, termStart);
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart,
      termEnd: '2026-06-30',
      status,
      joinedAt: termStart,
      endedAt: ['completed', 'transferred', 'dropped'].includes(status) ? '2026-06-30' : null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: `${termStart}T00:00:00.000Z`,
      statusChangedBy: 'seed',
      confirmedAt: `${termStart}T00:00:00.000Z`,
      confirmedBy: 'seed',
      createdAt: `${termStart}T00:00:00.000Z`,
      updatedAt: `${termStart}T00:00:00.000Z`,
      ...overrides,
    },
  };
}

function profile(id: string, overrides: Record<string, unknown> = {}) {
  return {
    [`students/${id}`]: {
      name: 'Quách Hoàng Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      studentId: 'HS260167',
      studentLifecycle: 'enrolled',
      // Deliberately stale: the whole point is that these are not consulted.
      classId: 'class-stale',
      teacherId: 'teacher-stale',
      enrollmentStatus: 'promoted',
      ...overrides,
    },
  };
}

const CLASSES = {
  'classes/class-g6': { name: 'G6', teacherId: 'teacher-1' },
  'classes/class-g7': { name: 'G7', teacherId: 'teacher-2' },
};

/**
 * The stored centre-wide headcount the directory reports.
 *
 * Counting the rows a filtered page happened to match answers a different
 * question than "how many students does this centre have", and the two were
 * being reported through the same field.
 */
function canonicalHeadcountModel(overrides: Record<string, unknown> = {}) {
  return {
    'read_models/dashboard_global': {
      id: 'dashboard_global',
      canonicalHeadcount: {
        schemaVersion: 3,
        physicalStudentDocumentCount: 4,
        canonicalProfileCount: 4,
        aliasCount: 0,
        tombstoneCount: 0,
        openEnrollmentCount: 3,
        trialCanonicalCount: 1,
        studyingCanonicalCount: 1,
        onLeaveCanonicalCount: 1,
        waitingForPlacementCanonicalCount: 1,
        inactiveCanonicalCount: 0,
        requiredModeBlockerCount: 0,
        complete: true,
        generatedAt: '2026-08-10T00:00:00.000Z',
        sourceUpdatedAt: '2026-08-10T00:00:00.000Z',
        ...overrides,
      },
    },
  };
}

function alias(legacyId: string, canonicalId: string) {
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

describe('readCanonicalStudentContext', () => {
  it('derives class, teacher, and status from the enrollment, never the profile fields', async () => {
    // The seeded profile carries classId: 'class-stale' and
    // enrollmentStatus: 'promoted'. Both are the compatibility projections
    // this repository exists to stop trusting.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const row = await readCanonicalStudentContext(db, 'canonical-1');

    expect(row).toMatchObject({
      id: 'canonical-1',
      canonicalProfileId: 'canonical-1',
      redirected: false,
      currentClassId: 'class-g7',
      currentTeacherId: 'teacher-2',
      placementStatus: 'studying',
    });
    expect(row.currentEnrollment?.classId).toBe('class-g7');
  });

  it('resolves an alias to one canonical row and marks the redirect', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const row = await readCanonicalStudentContext(db, 'legacy-1');

    expect(row).toMatchObject({
      id: 'canonical-1',
      canonicalProfileId: 'canonical-1',
      requestedProfileId: 'legacy-1',
      redirected: true,
    });
  });

  it('prefers the alias even while the physical source profile still exists', async () => {
    // Workstream C writes the alias in an earlier stage than the tombstone, so
    // for part of a merge run both documents exist and the alias is newer.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...profile('legacy-1', { studentId: 'HS260167' }),
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const row = await readCanonicalStudentContext(db, 'legacy-1');

    expect(row.canonicalProfileId).toBe('canonical-1');
  });

  it('reports waiting_for_placement for a completed course with nothing open', async () => {
    // This is the screenshot state: the human finished G6 and has not started
    // G7. The old code stamped the profile `promoted` and cloned it.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g6', '2026-01-05', 'completed'),
    });

    const row = await readCanonicalStudentContext(db, 'canonical-1');

    expect(row).toMatchObject({
      placementStatus: 'waiting_for_placement',
      currentClassId: null,
      currentTeacherId: null,
    });
    expect(row.lastEnrollment?.classId).toBe('class-g6');
  });

  it('picks the latest enrollment as last, not the first one read', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g6', '2026-01-05', 'completed'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'completed'),
    });

    const row = await readCanonicalStudentContext(db, 'canonical-1');

    expect(row.lastEnrollment?.classId).toBe('class-g7');
  });

  it('throws when a profile has two open enrollments', async () => {
    // Two opens is a data fault. Picking one would put the student on the
    // wrong roster and hide the other course entirely.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g6', '2026-01-05', 'active'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    await expect(readCanonicalStudentContext(db, 'canonical-1')).rejects.toThrow(
      'CANONICAL_STUDENT_MULTIPLE_OPEN_ENROLLMENTS'
    );
  });

  it('fails closed when the requested id resolves to nothing', async () => {
    const { db } = createInMemoryDocumentStore({ ...CLASSES });

    await expect(readCanonicalStudentContext(db, 'ghost')).rejects.toThrow(
      'STUDENT_IDENTITY_NOT_FOUND'
    );
  });
});

describe('readCanonicalStudentsByIds', () => {
  it('keys the result by the id the caller asked for, not the canonical one', async () => {
    // Callers hold legacy ids in historical records. Returning a map keyed on
    // the canonical id would make them silently miss every alias lookup.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const rows = await readCanonicalStudentsByIds(db, ['legacy-1', 'canonical-1']);

    expect([...rows.keys()].sort()).toEqual(['canonical-1', 'legacy-1']);
    expect(rows.get('legacy-1')?.canonicalProfileId).toBe('canonical-1');
    expect(rows.get('canonical-1')?.canonicalProfileId).toBe('canonical-1');
  });

  it('reads one canonical profile once even when several ids resolve to it', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...alias('legacy-2', 'canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const rows = await readCanonicalStudentsByIds(db, ['legacy-1', 'legacy-2', 'canonical-1']);

    const distinct = new Set([...rows.values()].map((row) => row.canonicalProfileId));
    expect(distinct).toEqual(new Set(['canonical-1']));
  });

  it('omits a profile with two open enrollments rather than guessing a status for it', async () => {
    // Unscoped, nothing says which course is current. Deriving anyway lands on
    // `inactive` — a student in two courses reported as attending none — which
    // is worse than an absent row, because absent is visible and wrong is not.
    const anomalies: CanonicalStudentReadAnomaly[] = [];
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('broken'),
      ...enrollment('broken', 'class-g6', '2026-01-05', 'active'),
      ...enrollment('broken', 'class-g7', '2026-07-01', 'active'),
    });

    const rows = await readCanonicalStudentsByIds(db, ['broken'], (anomaly) =>
      anomalies.push(anomaly)
    );

    expect([...rows.keys()]).toEqual([]);
    expect(anomalies).toEqual([
      { requestedProfileId: 'broken', canonicalProfileId: 'broken', code: 'MULTIPLE_OPEN_ENROLLMENTS' },
    ]);
  });

  it('omits an id that cannot be resolved rather than failing the whole batch', async () => {
    // A batch read backs list surfaces. One broken historical reference must
    // not blank an entire roster.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const rows = await readCanonicalStudentsByIds(db, ['canonical-1', 'ghost']);

    expect([...rows.keys()]).toEqual(['canonical-1']);
  });
});

describe('listCanonicalClassRoster', () => {
  it('starts from enrollments, so a stale profile classId adds nobody', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      // This profile claims class-g7 but has no enrollment there.
      ...profile('claims-g7', { classId: 'class-g7', enrollmentStatus: 'active' }),
      ...profile('real-g7'),
      ...enrollment('real-g7', 'class-g7', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    expect(roster.map((row) => row.canonicalProfileId)).toEqual(['real-g7']);
  });

  it('excludes a duplicate physical profile that has no open enrollment', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...profile('legacy-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('legacy-1', 'class-g6', '2026-01-05', 'completed'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    expect(roster).toHaveLength(1);
    expect(roster[0].canonicalProfileId).toBe('canonical-1');
  });

  it('omits closed enrollments from the default current scope', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('gone'),
      ...enrollment('gone', 'class-g7', '2026-07-01', 'transferred'),
    });

    const roster = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    expect(roster).toEqual([]);
  });

  it('includes a closed enrollment when a historical term is requested', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('past'),
      ...enrollment('past', 'class-g6', '2026-01-05', 'completed'),
    });

    const roster = await listCanonicalClassRoster(db, {
      classId: 'class-g6',
      termStart: '2026-01-05',
      includeStatuses: ['completed', 'transferred', 'active'],
    });

    expect(roster.map((row) => row.canonicalProfileId)).toEqual(['past']);
  });

  it('never leaks a past term into a current roster request', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('past'),
      ...enrollment('past', 'class-g6', '2026-01-05', 'completed'),
      ...profile('now'),
      ...enrollment('now', 'class-g6', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRoster(db, { classId: 'class-g6' });

    expect(roster.map((row) => row.canonicalProfileId)).toEqual(['now']);
  });

  it('orders deterministically by normalized name then profile id', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('p-b', { name: 'Bùi An' }),
      ...enrollment('p-b', 'class-g7', '2026-07-01', 'active'),
      ...profile('p-a', { name: 'Ánh Dương' }),
      ...enrollment('p-a', 'class-g7', '2026-07-01', 'active'),
      ...profile('p-c', { name: 'Ánh Dương' }),
      ...enrollment('p-c', 'class-g7', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    expect(roster.map((row) => row.canonicalProfileId)).toEqual(['p-a', 'p-c', 'p-b']);
  });

  it('returns one row per canonical profile even with several enrollments in the class', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g6', '2026-01-05', 'completed'),
      ...enrollment('canonical-1', 'class-g6', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRoster(db, {
      classId: 'class-g6',
      includeStatuses: ['active', 'completed'],
    });

    expect(roster).toHaveLength(1);
    expect(roster[0].placementStatus).toBe('studying');
  });

  it('reads the class document once for the whole roster', async () => {
    // Every row needs the teacher, and the teacher comes from the class. Read
    // per row, a thirty-student roster fetches the same document thirty times.
    const seed: Record<string, Record<string, unknown>> = { ...CLASSES };
    for (let index = 0; index < 6; index += 1) {
      Object.assign(
        seed,
        profile(`p-${index}`, { name: `Học Sinh ${index}` }),
        enrollment(`p-${index}`, 'class-g7', '2026-07-01', 'active')
      );
    }
    const { db, readLog } = createInMemoryDocumentStore(seed);

    const roster = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    expect(roster).toHaveLength(6);
    expect(readLog.filter((entry) => entry === 'classes/class-g7')).toHaveLength(1);
  });

  it('keeps a member with two open enrollments on the roster of the class they are enrolled in', async () => {
    // Two opens is a real data fault, and the single-student read refuses it.
    // A roster is a different question: this class's enrollment is not in
    // doubt, and thirty other students should not lose attendance because one
    // record is broken. The fault is reported instead of thrown.
    const anomalies: CanonicalStudentReadAnomaly[] = [];
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('broken'),
      ...enrollment('broken', 'class-g6', '2026-01-05', 'active'),
      ...enrollment('broken', 'class-g7', '2026-07-01', 'active'),
      ...profile('healthy', { name: 'Zzz Cuối' }),
      ...enrollment('healthy', 'class-g7', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRoster(db, {
      classId: 'class-g7',
      onAnomaly: (anomaly) => anomalies.push(anomaly),
    });

    expect(roster.map((row) => row.canonicalProfileId)).toEqual(['broken', 'healthy']);
    // Scoped to the requested class, so the row shows the enrollment that put
    // this student on this roster rather than an arbitrary one of the two.
    expect(roster[0].currentEnrollment?.classId).toBe('class-g7');
    expect(roster[0].currentTeacherId).toBe('teacher-2');
    expect(anomalies).toEqual([
      { requestedProfileId: 'broken', canonicalProfileId: 'broken', code: 'MULTIPLE_OPEN_ENROLLMENTS' },
    ]);
  });

  it('skips a roster member whose profile document is gone without blanking the class', async () => {
    const anomalies: CanonicalStudentReadAnomaly[] = [];
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('present'),
      ...enrollment('present', 'class-g7', '2026-07-01', 'active'),
      // Enrollment with no profile document behind it.
      ...enrollment('vanished', 'class-g7', '2026-07-01', 'active'),
    });

    const roster = await listCanonicalClassRoster(db, {
      classId: 'class-g7',
      onAnomaly: (anomaly) => anomalies.push(anomaly),
    });

    expect(roster.map((row) => row.canonicalProfileId)).toEqual(['present']);
    expect(anomalies.map((anomaly) => anomaly.code)).toEqual(['UNRESOLVABLE_ID']);
  });
});

describe('listCanonicalStudentDirectory', () => {
  function directorySeed() {
    return {
      ...CLASSES,
      ...canonicalHeadcountModel(),
      ...profile('p-studying', { name: 'Bùi An' }),
      ...enrollment('p-studying', 'class-g7', '2026-07-01', 'active'),
      ...profile('p-waiting', { name: 'Ánh Dương' }),
      ...enrollment('p-waiting', 'class-g6', '2026-01-05', 'completed'),
      ...profile('p-trial', { name: 'Cao Kỳ', studentLifecycle: 'trial' }),
      ...enrollment('p-trial', 'class-g7', '2026-07-01', 'trial'),
      ...profile('p-leave', { name: 'Đỗ Minh' }),
      ...enrollment('p-leave', 'class-g7', '2026-07-01', 'on_leave'),
    };
  }

  it('returns one row per canonical profile', async () => {
    const { db } = createInMemoryDocumentStore(directorySeed());

    const page = await listCanonicalStudentDirectory(db, { limit: 50 });

    expect(page.rows.map((row) => row.canonicalProfileId).sort()).toEqual([
      'p-leave',
      'p-studying',
      'p-trial',
      'p-waiting',
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('reads candidates in bounded pages and enriches in id chunks', async () => {
    // A full collection read and a bounded page return the same rows, so this
    // is the only place the difference is visible. Without it the directory
    // can quietly go back to loading every student to answer a page of two.
    const { db, queryLog } = createInMemoryDocumentStore(directorySeed());

    await listCanonicalStudentDirectory(db, { limit: 2 });

    const studentQueries = queryLog.filter((entry) => entry.collection === 'students');
    expect(studentQueries.length).toBeGreaterThan(0);
    expect(studentQueries.every((entry) => typeof entry.take === 'number')).toBe(true);

    const enrollmentQueries = queryLog.filter(
      (entry) => entry.collection === 'student_course_enrollments'
    );
    expect(
      enrollmentQueries.every((entry) =>
        entry.filters.some(
          ([field, op, ids]) =>
            field === 'studentId' && op === 'in' && Array.isArray(ids) && ids.length <= 30
        )
      )
    ).toBe(true);
  });

  it('walks every profile through bounded pages when collecting the projection', async () => {
    // More profiles than one candidate page, so a collector that reads a
    // single page and stops is caught here rather than by an operator noticing
    // the dashboard is short.
    const seed: Record<string, Record<string, unknown>> = {
      ...CLASSES,
      ...canonicalHeadcountModel({ canonicalProfileCount: 205, studyingCanonicalCount: 205 }),
    };
    for (let index = 0; index < 205; index += 1) {
      const id = `p-${String(index).padStart(3, '0')}`;
      Object.assign(seed, profile(id, { name: `Student ${index}` }));
      Object.assign(seed, enrollment(id, 'class-g7', '2026-07-01', 'active'));
    }
    const { db, queryLog } = createInMemoryDocumentStore(seed);

    const { rows, anomalies } = await collectCanonicalStudentDirectoryProjection(db);

    expect(rows).toHaveLength(205);
    expect(anomalies).toEqual([]);
    const studentQueries = queryLog.filter((entry) => entry.collection === 'students');
    expect(studentQueries.length).toBeGreaterThanOrEqual(3);
    expect(studentQueries.every((entry) => typeof entry.take === 'number')).toBe(true);
  });

  it('reports the centre-wide counts from the stored projection', async () => {
    const { db } = createInMemoryDocumentStore(directorySeed());

    await expect(readCanonicalDirectoryCounts(db)).resolves.toEqual({
      canonicalProfiles: 4,
      trial: 1,
      studying: 1,
      onLeave: 1,
      waitingForPlacement: 1,
    });
  });

  it('refuses to invent counts when the stored projection is missing or incomplete', async () => {
    // Counting whatever a page matched would answer a different question and
    // look like an answer to this one.
    const missing = createInMemoryDocumentStore({ ...CLASSES, ...profile('p-1') });
    await expect(readCanonicalDirectoryCounts(missing.db)).rejects.toThrow(
      'CANONICAL_STUDENT_DIRECTORY_COUNTS_INCOMPLETE'
    );

    const incomplete = createInMemoryDocumentStore({
      ...CLASSES,
      ...canonicalHeadcountModel({ complete: false }),
      ...profile('p-1'),
    });
    await expect(readCanonicalDirectoryCounts(incomplete.db)).rejects.toThrow(
      'CANONICAL_STUDENT_DIRECTORY_COUNTS_INCOMPLETE'
    );
  });

  it('excludes an aliased profile so a merged human appears once', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...canonicalHeadcountModel({ canonicalProfileCount: 1, studyingCanonicalCount: 1 }),
      ...profile('canonical-1'),
      ...profile('legacy-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });

    const page = await listCanonicalStudentDirectory(db, { limit: 50 });

    expect(page.rows.map((row) => row.canonicalProfileId)).toEqual(['canonical-1']);
  });

  it('pages by a stable cursor without repeating or dropping a row', async () => {
    const { db } = createInMemoryDocumentStore(directorySeed());

    const first = await listCanonicalStudentDirectory(db, { limit: 2 });
    // Candidates are scanned by document id — p-leave, p-studying — because the
    // cursor is an id and nothing else: a sort key here is a student's name in
    // a URL and an access log. Rows inside the page are still returned in
    // display order, which is why Bùi An precedes Đỗ Minh.
    expect(first.rows.map((row) => row.canonicalProfileId)).toEqual(['p-studying', 'p-leave']);
    expect(first.nextCursor).not.toBeNull();

    const second = await listCanonicalStudentDirectory(db, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.rows.map((row) => row.canonicalProfileId)).toEqual(['p-waiting', 'p-trial']);
    expect(second.nextCursor).toBeNull();
  });

  it('filters by placement status, which no profile field records', async () => {
    const { db } = createInMemoryDocumentStore(directorySeed());

    const page = await listCanonicalStudentDirectory(db, {
      limit: 50,
      placementStatus: 'waiting_for_placement',
    });

    expect(page.rows.map((row) => row.canonicalProfileId)).toEqual(['p-waiting']);
  });

  it('filters by class through enrollments, never through the stale profile field', async () => {
    const { db } = createInMemoryDocumentStore({
      ...directorySeed(),
      // Claims class-g7 on the profile with no enrollment to back it.
      ...profile('impostor', { name: 'Ế Ẩm', classId: 'class-g7' }),
      ...enrollment('impostor', 'class-g6', '2026-07-01', 'active'),
    });

    const page = await listCanonicalStudentDirectory(db, { limit: 50, classId: 'class-g7' });

    expect(page.rows.map((row) => row.canonicalProfileId).sort()).toEqual([
      'p-leave',
      'p-studying',
      'p-trial',
    ]);
  });

  it('matches a search term against the name', async () => {
    const { db } = createInMemoryDocumentStore(directorySeed());

    const page = await listCanonicalStudentDirectory(db, { limit: 50, search: 'ánh' });

    expect(page.rows.map((row) => row.canonicalProfileId)).toEqual(['p-waiting']);
  });

  it('omits a profile with two open enrollments and names the fault', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...canonicalHeadcountModel({ canonicalProfileCount: 1, studyingCanonicalCount: 1 }),
      ...profile('ok'),
      ...enrollment('ok', 'class-g7', '2026-07-01', 'active'),
      ...profile('broken', { name: 'Hai Lớp' }),
      ...enrollment('broken', 'class-g6', '2026-01-05', 'active'),
      ...enrollment('broken', 'class-g7', '2026-07-01', 'active'),
    });

    const page = await listCanonicalStudentDirectory(db, { limit: 50 });

    expect(page.rows.map((row) => row.canonicalProfileId)).toEqual(['ok']);
    expect(page.anomalies).toEqual([
      { requestedProfileId: 'broken', canonicalProfileId: 'broken', code: 'MULTIPLE_OPEN_ENROLLMENTS' },
    ]);
  });

  it('reports an underivable profile instead of failing the whole directory', async () => {
    // A profile claiming to be enrolled with no enrollment record at all.
    // Production has these; a directory that throws on the first one is a
    // directory nobody can open.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...canonicalHeadcountModel({ canonicalProfileCount: 1, studyingCanonicalCount: 1 }),
      ...profile('ok'),
      ...enrollment('ok', 'class-g7', '2026-07-01', 'active'),
      ...profile('no-enrollment', { name: 'Không Có Lớp' }),
    });

    const page = await listCanonicalStudentDirectory(db, { limit: 50 });

    expect(page.rows.map((row) => row.canonicalProfileId)).toEqual(['ok']);
    expect(page.anomalies).toEqual([
      {
        requestedProfileId: 'no-enrollment',
        canonicalProfileId: 'no-enrollment',
        code: 'PLACEMENT_UNDERIVABLE',
      },
    ]);
  });

  it('reads the enrollment collection once per id chunk, not once per profile', async () => {
    const { db, readLog } = createInMemoryDocumentStore(directorySeed());

    await listCanonicalStudentDirectory(db, { limit: 50 });

    // Four profiles fit in one 30-id chunk, so one query answers all of them.
    expect(
      readLog.filter((entry) => entry === 'query:student_course_enrollments')
    ).toHaveLength(1);
  });
});

describe('compareCanonicalStudentReadSets', () => {
  it('reports the screenshot pattern as one legacy physical duplicate', async () => {
    // The production shape: the same human present twice in the legacy answer,
    // once as a `promoted` G6 row and once as an `active` G7 row. Canonical
    // returns one row, and the gap has to be named rather than averaged away.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...profile('legacy-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...enrollment('legacy-1', 'class-g6', '2026-01-05', 'completed'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });
    const canonical = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    const discrepancies = await compareCanonicalStudentReadSets(
      db,
      'class_roster',
      ['legacy-1', 'canonical-1'],
      canonical
    );

    expect(canonical).toHaveLength(1);
    expect(discrepancies).toEqual([
      {
        surface: 'class_roster',
        reasonCode: 'LEGACY_PHYSICAL_DUPLICATE',
        canonicalProfileIds: ['canonical-1'],
        legacyProfileIds: ['canonical-1', 'legacy-1'],
        legacyCount: 2,
        canonicalCount: 1,
      },
    ]);
  });

  it('says nothing when the two answers already agree', async () => {
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });
    const canonical = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    await expect(
      compareCanonicalStudentReadSets(db, 'class_roster', ['canonical-1'], canonical)
    ).resolves.toEqual([]);
  });

  it('reports a canonical row the legacy answer never had', async () => {
    // The direction that matters for shadow mode: canonical finding a student
    // legacy missed is not "extra data", it is a legacy read that was wrong.
    const { db } = createInMemoryDocumentStore({
      ...CLASSES,
      ...profile('canonical-1'),
      ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
    });
    const canonical = await listCanonicalClassRoster(db, { classId: 'class-g7' });

    const discrepancies = await compareCanonicalStudentReadSets(db, 'class_roster', [], canonical);

    expect(discrepancies).toEqual([
      {
        surface: 'class_roster',
        reasonCode: 'LEGACY_ROW_MISSING',
        canonicalProfileIds: ['canonical-1'],
        legacyProfileIds: [],
        legacyCount: 0,
        canonicalCount: 1,
      },
    ]);
  });
});
