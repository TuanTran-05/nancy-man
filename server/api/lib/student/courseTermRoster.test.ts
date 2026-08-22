import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { loadCourseTermRosters } from './courseTermRoster.js';

function enrollment(
  studentId: string,
  classId: string,
  termStart: string,
  status: 'trial' | 'active' | 'on_leave' | 'completed' | 'transferred' | 'dropped'
) {
  const id = makeStudentCourseEnrollmentId(studentId, classId, termStart);
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId,
      classId,
      termStart,
      termEnd: '2026-08-08',
      status,
      joinedAt: termStart,
      endedAt: ['completed', 'transferred', 'dropped'].includes(status)
        ? '2026-08-08'
        : null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: '2026-08-08T00:00:00.000Z',
      statusChangedBy: 'test',
      confirmedAt: null,
      confirmedBy: null,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
  };
}

describe('loadCourseTermRosters', () => {
  it('uses the requested class term instead of the profile class projection', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/concurrent': {
        name: 'Concurrent Student',
        classId: 'class-b',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      ...enrollment('concurrent', 'class-a', '2026-06-14', 'active'),
      ...enrollment('concurrent', 'class-b', '2026-07-08', 'active'),
    });

    const rosters = await loadCourseTermRosters(db, [
      { classId: 'class-a', termStart: '2026-06-14' },
      { classId: 'class-b', termStart: '2026-07-08' },
    ]);

    expect(rosters.get('class-a')?.map((member) => member.studentDoc.id)).toEqual([
      'concurrent',
    ]);
    expect(rosters.get('class-b')?.map((member) => member.studentDoc.id)).toEqual([
      'concurrent',
    ]);
  });

  it.each(['transferred', 'dropped'] as const)(
    'excludes a %s enrollment',
    async (status) => {
      const { db } = createInMemoryDocumentStore({
        'students/left': { name: 'Left Student', classId: 'class-a' },
        ...enrollment('left', 'class-a', '2026-06-14', status),
      });
      const rosters = await loadCourseTermRosters(db, [
        { classId: 'class-a', termStart: '2026-06-14' },
      ]);
      expect(rosters.get('class-a')).toEqual([]);
    }
  );

  it('excludes another term and falls back only for a scope without termStart', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/current': { name: 'Current', classId: 'class-a' },
      'students/legacy': { name: 'Legacy', classId: 'legacy-class' },
      ...enrollment('current', 'class-a', '2026-01-01', 'completed'),
    });
    const rosters = await loadCourseTermRosters(db, [
      { classId: 'class-a', termStart: '2026-06-14' },
      { classId: 'legacy-class' },
    ]);
    expect(rosters.get('class-a')).toEqual([]);
    expect(rosters.get('legacy-class')?.map((member) => member.studentDoc.id)).toEqual([
      'legacy',
    ]);
    expect(rosters.get('legacy-class')?.[0].source).toBe('legacy_profile');
  });

  it('batches enrollment queries for 31 class scopes and hydrates shared profiles once', async () => {
    const seed: Record<string, any> = {
      'students/shared-student': { name: 'Shared Student', classId: 'class-0' },
    };

    const scopes: Array<{ classId: string; termStart: string }> = [];
    for (let index = 0; index < 31; index += 1) {
      const classId = `class-${index}`;
      const termStart = '2026-06-14';
      scopes.push({ classId, termStart });
      Object.assign(
        seed,
        enrollment('shared-student', classId, termStart, 'active')
      );
    }

    const { db, queryLog, readLog } = createInMemoryDocumentStore(seed);

    const rosters = await loadCourseTermRosters(db, scopes);

    expect(rosters.size).toBe(31);

    const enrollmentQueries = queryLog.filter(
      (entry) => entry.collection === 'student_course_enrollments'
    );
    expect(enrollmentQueries).toHaveLength(2);
    for (const query of enrollmentQueries) {
      const inFilter = query.filters.find(([field, op]) => field === 'classId' && op === 'in');
      expect(inFilter).toBeDefined();
      const inValues = inFilter![2] as string[];
      expect(inValues.length).toBeLessThanOrEqual(30);
    }

    const sharedStudentReads = readLog.filter(
      (path) => path === 'students/shared-student'
    );
    expect(sharedStudentReads).toHaveLength(1);
  });

  it('falls back to profile classId when termStart is malformed', async () => {
    const { db, queryLog } = createInMemoryDocumentStore({
      'students/legacy': { name: 'Legacy', classId: 'legacy-class' },
      ...enrollment('legacy', 'legacy-class', '2026-01-01', 'completed'),
    });

    const rosters = await loadCourseTermRosters(db, [
      { classId: 'legacy-class', termStart: 'not-a-date' },
    ]);

    expect(rosters.get('legacy-class')?.map((member) => member.studentDoc.id)).toEqual([
      'legacy',
    ]);
    expect(rosters.get('legacy-class')?.[0].source).toBe('legacy_profile');
    expect(
      queryLog.filter((entry) => entry.collection === 'student_course_enrollments')
    ).toHaveLength(0);
  });
});
