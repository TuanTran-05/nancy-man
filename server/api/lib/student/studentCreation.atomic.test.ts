import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStudentRecord,
  createStudentWithGeneratedCode,
} from './studentCreation.js';
import { resetCanonicalStudentReadControlCacheForTests } from './canonicalStudentReadControl.js';

vi.mock('@/server/db/documentStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/db/documentStore.js')>()),
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

vi.mock('../logging/auditLog.js', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(true),
}));

describe('createStudentRecord transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T01:00:00.000Z'));
    resetCanonicalStudentReadControlCacheForTests();
  });

  function makeEndedCourseCreationDb(studentId: string) {
    const studentRef = { id: studentId };
    const counterRef = { id: 'students_26' };
    const classRef = {
      id: 'class-ended',
      get: vi.fn(async () => ({ exists: false, data: () => undefined })),
    };
    const enrollmentRefs: Array<{ id: string }> = [];
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef
          ? { exists: true, data: () => ({ seq: 3 }) }
          : { empty: true, docs: [] }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The registry claim stages the code ownership document.
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') return { ...query, doc: vi.fn(() => studentRef) };
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'student_course_enrollments') {
          return {
            doc: vi.fn((id: string) => {
              const ref = { id };
              enrollmentRefs.push(ref);
              return ref;
            }),
          };
        }
        return {};
      }),
      // Maintenance state, the code registry, and alias lookups are all direct
      // document reads. Absent in these fixtures, which is the normal case:
      // no maintenance window, no registry record, no alias.
      doc: vi.fn((path: string) => ({ path })),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    return { db, tx, studentRef, enrollmentRefs };
  }

  it('reserves the student code, creates the student, and updates class counts atomically', async () => {
    const studentRef = { id: 'student-new' };
    const counterRef = { id: 'students_26' };
    // Course-closing invalidation reads the class before deciding to write.
    const classRef = {
      id: 'class-1',
      get: vi.fn(async () => ({ exists: false, data: () => undefined })),
    };
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef
          ? { exists: true, data: () => ({ seq: 3 }) }
          : { empty: true, docs: [] }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The registry claim stages the code ownership document.
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') return { ...query, doc: vi.fn(() => studentRef) };
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'student_course_enrollments') {
          return { doc: vi.fn((id: string) => ({ id })) };
        }
        if (name === 'student_course_enrollments') {
          return { doc: vi.fn((id: string) => ({ id })) };
        }
        return {};
      }),
      // Maintenance state, the code registry, and alias lookups are all direct
      // document reads. Absent in these fixtures, which is the normal case:
      // no maintenance window, no registry record, no alias.
      doc: vi.fn((path: string) => ({ path })),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };

    const result = await createStudentRecord({
      req: { headers: {} } as any,
      db,
      user: { uid: 'office-1' },
      userInfo: { role: 'office', name: 'Office' },
      classData: { teacherId: 'teacher-1', startDate: '2026-01-05', endDate: '2026-12-31' },
      body: {
        name: 'Student One',
        dob: '2014-01-01',
        contact: '0384072314',
        classId: 'class-1',
      },
    });

    expect(result).toMatchObject({ id: 'student-new', studentId: 'HS260004' });
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(tx.create).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({ studentId: 'HS260004', enrollmentStatus: 'active' })
    );
    expect(tx.update).toHaveBeenCalledWith(
      classRef,
      expect.objectContaining({
        'studentCounts.total': 'increment:1',
        'studentCounts.active': 'increment:1',
      })
    );
  });

  it('omits legacy relationship fields when canonical-required is read in the transaction', async () => {
    const studentRef = { id: 'student-new' };
    const counterRef = { id: 'students_26' };
    const readControlRef = { path: '_maintenance/student_identity_read_model' };
    const classRef = { id: 'class-1' };
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === counterRef) return { exists: true, data: () => ({ seq: 3 }) };
        if (target === readControlRef) {
          return {
            exists: true,
            data: () => ({ schemaVersion: 1, mode: 'canonical_required', generation: 1 }),
          };
        }
        return { empty: true, docs: [] };
      }),
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') return { ...query, doc: vi.fn(() => studentRef) };
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        return {};
      }),
      doc: vi.fn((path: string) =>
        path === '_maintenance/student_identity_read_model' ? readControlRef : { path }
      ),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };

    await createStudentWithGeneratedCode(
      db,
      (studentId) => ({
        name: 'Student One',
        dob: '2014-01-01',
        contact: '0384072314',
        studentId,
        classId: 'class-1',
        teacherId: 'teacher-1',
        enrollmentStatus: 'active',
      }),
      undefined,
      { actorId: 'office-1', actorRole: 'office', mutationOperation: 'student_create' }
    );

    expect(tx.create).toHaveBeenCalledWith(studentRef, {
      name: 'Student One',
      dob: '2014-01-01',
      contact: '0384072314',
      studentId: 'HS260004',
    });
  });

  it('keeps a canonical-required profile clean while counters and roster use its canonical enrollment', async () => {
    const studentRef = { id: 'student-canonical' };
    const counterRef = { id: 'students_26' };
    const readControlRef = { path: '_maintenance/student_identity_read_model' };
    const classRef = {
      id: 'class-1',
      get: vi.fn(async () => ({ exists: true, data: () => ({}) })),
    };
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === counterRef) return { exists: true, data: () => ({ seq: 3 }) };
        if (target === readControlRef) {
          return {
            exists: true,
            data: () => ({ schemaVersion: 1, mode: 'canonical_required', generation: 1 }),
          };
        }
        return { empty: true, docs: [] };
      }),
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') return { ...query, doc: vi.fn(() => studentRef) };
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'student_course_enrollments') {
          return { doc: vi.fn((id: string) => ({ id })) };
        }
        return {};
      }),
      doc: vi.fn((path: string) =>
        path === '_maintenance/student_identity_read_model' ? readControlRef : { path }
      ),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };

    await createStudentRecord({
      req: { headers: {} } as any,
      db,
      user: { uid: 'office-1' },
      userInfo: { role: 'office', name: 'Office' },
      classData: { teacherId: 'teacher-1', startDate: '2026-01-05', endDate: '2026-12-31' },
      body: {
        name: 'Canonical Student',
        dob: '2014-01-01',
        contact: '0384072314',
        classId: 'class-1',
      },
    });

    const persistedProfile = tx.create.mock.calls.find(([ref]) => ref === studentRef)?.[1];
    expect(persistedProfile).not.toHaveProperty('classId');
    expect(persistedProfile).not.toHaveProperty('teacherId');
    expect(persistedProfile).not.toHaveProperty('enrollmentStatus');
    expect(tx.update).toHaveBeenCalledWith(
      classRef,
      expect.objectContaining({
        'studentCounts.total': 'increment:1',
        'studentCounts.active': 'increment:1',
      })
    );
    expect(classRef.get).toHaveBeenCalledTimes(1);
  });

  it('still enrols a student into a class whose course term already ended', async () => {
    const studentRef = { id: 'student-late' };
    const counterRef = { id: 'students_26' };
    const classRef = {
      id: 'class-ended',
      get: vi.fn(async () => ({ exists: false, data: () => undefined })),
    };
    const enrollmentRefs: Array<{ id: string }> = [];
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef
          ? { exists: true, data: () => ({ seq: 3 }) }
          : { empty: true, docs: [] }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The registry claim stages the code ownership document.
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') return { ...query, doc: vi.fn(() => studentRef) };
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'student_course_enrollments') {
          return {
            doc: vi.fn((id: string) => {
              const ref = { id };
              enrollmentRefs.push(ref);
              return ref;
            }),
          };
        }
        return {};
      }),
      // Maintenance state, the code registry, and alias lookups are all direct
      // document reads. Absent in these fixtures, which is the normal case:
      // no maintenance window, no registry record, no alias.
      doc: vi.fn((path: string) => ({ path })),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };

    const result = await createStudentRecord({
      req: { headers: {} } as any,
      db,
      user: { uid: 'office-1' },
      userInfo: { role: 'office', name: 'Office' },
      classData: { teacherId: 'teacher-1', startDate: '2026-01-05', endDate: '2026-03-31' },
      body: {
        name: 'Late Joiner',
        dob: '2014-01-01',
        contact: '0384072314',
        classId: 'class-ended',
      },
    });

    expect(result).toMatchObject({ id: 'student-late', studentId: 'HS260004' });
    expect(tx.create).toHaveBeenCalledWith(
      enrollmentRefs[0],
      expect.objectContaining({
        classId: 'class-ended',
        termStart: '2026-01-05',
        termEnd: '2026-03-31',
        joinedAt: '2026-03-31',
        status: 'active',
      })
    );
  });

  it('honours an explicit joinedAt and stamps the attendance course join', async () => {
    const { db, tx, studentRef, enrollmentRefs } =
      makeEndedCourseCreationDb('student-backfill');

    await createStudentRecord({
      req: { headers: {} } as any,
      db,
      user: { uid: 'office-1' },
      userInfo: { role: 'office', name: 'Office' },
      classData: { teacherId: 'teacher-1', startDate: '2026-01-05', endDate: '2026-03-31' },
      body: {
        name: 'Back Filled',
        dob: '2014-01-01',
        contact: '0384072314',
        classId: 'class-ended',
        joinedAt: '2026-02-10',
      },
    });

    expect(tx.create).toHaveBeenCalledWith(
      enrollmentRefs[0],
      expect.objectContaining({ joinedAt: '2026-02-10' })
    );
    expect(tx.create).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({
        courseJoins: [
          { classId: 'class-ended', termStart: '2026-01-05', joinedAt: '2026-02-10' },
        ],
      })
    );
  });

  it('rejects an explicit joinedAt outside the course term before writing', async () => {
    const { db, tx } = makeEndedCourseCreationDb('student-bad-date');

    await expect(
      createStudentRecord({
        req: { headers: {} } as any,
        db,
        user: { uid: 'office-1' },
        userInfo: { role: 'office', name: 'Office' },
        classData: {
          teacherId: 'teacher-1',
          startDate: '2026-01-05',
          endDate: '2026-03-31',
        },
        body: {
          name: 'Bad Date',
          dob: '2014-01-01',
          contact: '0384072314',
          classId: 'class-ended',
          joinedAt: '2026-04-15',
        },
      })
    ).rejects.toThrow('joinedAt must fall between 2026-01-05 and 2026-03-31');
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('rejects creating a duplicate student when an existing record is dropped in the same class', async () => {
    const studentRef = { id: 'student-new' };
    const counterRef = { id: 'students_26' };
    // Course-closing invalidation reads the class before deciding to write.
    const classRef = {
      id: 'class-1',
      get: vi.fn(async () => ({ exists: false, data: () => undefined })),
    };
    let enrollmentStatusFilter: unknown;
    const duplicateDoc = {
      id: 'stu-dropped',
      data: () => ({
        name: 'Nguyen Van A',
        dob: '2014-01-01',
        classId: 'class-1',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'enrolled',
      }),
    };
    const query: any = {
      where: vi.fn((field: string, _operator: string, value: unknown) => {
        if (field === 'enrollmentStatus') enrollmentStatusFilter = value;
        return query;
      }),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn(async () => {
        const protectsDropped =
          Array.isArray(enrollmentStatusFilter) && enrollmentStatusFilter.includes('dropped');
        return {
          empty: !protectsDropped,
          docs: protectsDropped ? [duplicateDoc] : [],
        };
      }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === counterRef) return { exists: true, data: () => ({ seq: 3 }) };
        if (typeof target?.get === 'function') return target.get();
        return { empty: true, docs: [] };
      }),
      update: vi.fn(),
      create: vi.fn(),
      // The registry claim stages the code ownership document.
      set: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') return { ...query, doc: vi.fn(() => studentRef) };
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        return {};
      }),
      // Maintenance state, the code registry, and alias lookups are all direct
      // document reads. Absent in these fixtures, which is the normal case:
      // no maintenance window, no registry record, no alias.
      doc: vi.fn((path: string) => ({ path })),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };

    await expect(
      createStudentRecord({
        req: { headers: {} } as any,
        db,
        user: { uid: 'admin-uid' },
        userInfo: { role: 'admin', name: 'Admin' },
      classData: { teacherId: 'teacher-1', startDate: '2026-01-05', endDate: '2026-12-31' },
        body: {
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
          classId: 'class-1',
        },
      })
    ).rejects.toThrow('Restore the existing record');

    expect(db.runTransaction).toHaveBeenCalledTimes(1);
  });
});
