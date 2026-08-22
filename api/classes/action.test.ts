import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/classes/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { enforceRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { getStudentCredentials } from '../../server/api/lib/student/studentCredentials.js';
import { touchRealtimeEvent } from '../../server/api/lib/realtime/events.js';
import { writeAuditLog } from '../../server/api/lib/logging/auditLog.js';
import {
  createDocumentStoreTransactionHarness,
  makeDocumentStoreDocSnapshot,
  makeDocumentStoreQuerySnapshot,
} from '../../server/api/lib/documentStore/testDocumentStoreMocks.js';
import { makeStudentCourseEnrollmentId } from '../../shared/studentCourseEnrollment.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldPath: {
    documentId: vi.fn(() => '__name__'),
  },
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
    delete: vi.fn(() => '__delete__'),
  },
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => {
  const getDb = vi.fn();
  const verifyAuthToken = vi.fn();
  const verifyAuthContext = vi.fn(async (req, res, requiredRoles) => {
    const user = await verifyAuthToken(req, res, requiredRoles);
    if (!user) return null;
    const db = getDb();
    let role = 'unknown';
    let name = user.uid;
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      const data = userDoc?.data() || {};
      role = data.role || 'unknown';
      name = data.displayName || data.name || user.email || user.uid;
    } catch (e) {
      // ignore error
    }
    return {
      decoded: user,
      context: {
        uid: user.uid,
        email: user.email || '',
        role,
        name,
      },
    };
  });
  return {
    getDb,
    verifyAuthToken,
    verifyAuthContext,
  };
});

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/api/lib/student/studentCredentials.js', () => ({
  getStudentCredentials: vi.fn(),
}));

vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/services/adminClassTuitionSnapshotInvalidation.js', () => ({
  invalidateAdminClassTuitionSnapshotHealth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/api/lib/logging/auditLog.js')>();
  return {
    ...actual,
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
    writeAuditLog: vi.fn().mockResolvedValue(true),
  };
});

function mockRes() {
  const res: any = { statusCode: 200 };
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end = vi.fn();
  return res;
}

function makeDoc(id: string, data: Record<string, unknown>) {
  return makeDocumentStoreDocSnapshot({
    id,
    path: `students/${id}`,
    data,
  });
}

function matches(data: Record<string, unknown>, constraints: Array<[string, string, unknown]>) {
  return constraints.every(([field, op, value]) => {
    if (op === '==') return data[field] === value;
    if (op === 'in' && Array.isArray(value)) return value.includes(data[field]);
    return true;
  });
}

function makeQuery(docs: ReturnType<typeof makeDoc>[]) {
  const constraints: Array<[string, string, unknown]> = [];
  const query: any = {
    where: vi.fn((field: string, op: string, value: unknown) => {
      constraints.push([field, op, value]);
      return query;
    }),
    // Enrollment reads order by termStart and ledger reads limit; neither
    // changes which documents a fixture of this size returns.
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn(async () => {
      const matchedDocs = docs.filter((doc) => matches(doc.data(), constraints));
      return makeDocumentStoreQuerySnapshot(matchedDocs);
    }),
  };
  return query;
}

function mockClassesDb(options: {
  classes: Record<string, Record<string, unknown>>;
  students?: ReturnType<typeof makeDoc>[];
  evaluations?: ReturnType<typeof makeDoc>[];
  ledgers?: ReturnType<typeof makeDoc>[];
  users?: ReturnType<typeof makeDoc>[];
  /**
   * Class membership authority. Promotion reads this rather than
   * `students.classId`, so a fixture without enrollments has an empty roster
   * however many student documents claim the class.
   */
  enrollments?: ReturnType<typeof makeDoc>[];
  systemHolidays?: string[];
}) {
  const students = options.students || [];
  const enrollments = options.enrollments || [];
  const evaluations = options.evaluations || [];
  const ledgers = options.ledgers || [];
  const users = [
    makeDoc('admin-uid', { role: 'admin', displayName: 'Admin' }),
    ...(options.users || []),
  ];
  const batchOps: Array<{ type: 'set' | 'update'; ref: any; data: Record<string, unknown> }> = [];
  const batches: any[] = [];
  let generatedStudentSeq = 0;
  const transactionHarness = createDocumentStoreTransactionHarness();

  const classRefs = new Map(
    Object.entries(options.classes).map(([id, data]) => [
      id,
      {
        id,
        ref: { id, path: `classes/${id}` },
        get: vi.fn(async () => ({
          id,
          ref: { id, path: `classes/${id}` },
          exists: true,
          data: () => ({ ...data }),
        })),
        update: vi.fn(async (updateData: Record<string, unknown>) => {
          Object.assign(data, updateData);
        }),
      },
    ])
  );

  const db: any = {
    runTransaction: transactionHarness.runTransaction,
    // Path-addressed reads: maintenance state, aliases, the code registry, and
    // the canonical resolver's profile lookup all arrive this way.
    doc: vi.fn((path: string) => {
      const [collection, docId] = [
        path.slice(0, path.indexOf('/')),
        path.slice(path.indexOf('/') + 1),
      ];
      const seeded =
        collection === 'students'
          ? students.find((doc) => doc.id === docId)
          : collection === 'student_course_enrollments'
            ? enrollments.find((doc) => doc.id === docId)
            : undefined;
      if (seeded) return seeded.ref;
      return {
        path,
        id: docId,
        get: async () => ({ exists: false, data: () => undefined }),
      };
    }),
    batch: vi.fn(() => {
      const batch = {
        set: vi.fn((ref: any, data: Record<string, unknown>) => {
          batchOps.push({ type: 'set', ref, data });
        }),
        update: vi.fn((ref: any, data: Record<string, unknown>) => {
          batchOps.push({ type: 'update', ref, data });
        }),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      batches.push(batch);
      return batch;
    }),
    collection: vi.fn((name: string) => {
      if (name === 'classes') {
        const classDocs = Array.from(classRefs.values()).map((classRef) =>
          makeDocumentStoreDocSnapshot({
            id: classRef.id,
            path: `classes/${classRef.id}`,
            data: { ...options.classes[classRef.id] },
          })
        );
        return {
          doc: vi.fn(
            (id: string) => classRefs.get(id) || { get: vi.fn(async () => ({ exists: false })) }
          ),
          where: (...args: [string, string, unknown]) => makeQuery(classDocs).where(...args),
          get: vi.fn(async () => makeDocumentStoreQuerySnapshot(classDocs)),
        };
      }
      if (name === 'students') {
        return {
          where: (...args: [string, string, unknown]) => makeQuery(students).where(...args),
          doc: vi.fn((id?: string) => {
            if (id) {
              const seeded = students.find((doc) => doc.id === id);
              return (
                seeded?.ref ?? {
                  id,
                  path: `students/${id}`,
                  get: async () => ({ exists: false, data: () => undefined }),
                }
              );
            }
            generatedStudentSeq++;
            return {
              id: `new-student-${generatedStudentSeq}`,
              path: `students/new-student-${generatedStudentSeq}`,
            };
          }),
        };
      }
      if (name === 'student_course_enrollments') {
        return {
          where: (...args: [string, string, unknown]) => makeQuery(enrollments).where(...args),
          doc: vi.fn((id: string) => {
            const seeded = enrollments.find((doc) => doc.id === id);
            return (
              seeded?.ref ?? {
                id,
                path: `student_course_enrollments/${id}`,
                get: async () => ({ exists: false, data: () => undefined }),
              }
            );
          }),
        };
      }
      if (name === 'payment_requests' || name === 'student_progression_events') {
        return {
          where: (...args: [string, string, unknown]) => makeQuery([]).where(...args),
          doc: vi.fn((id: string) => ({
            id,
            path: `${name}/${id}`,
            get: async () => ({ exists: false, data: () => undefined }),
          })),
        };
      }
      if (name === 'student_auth_credentials') {
        return {
          doc: vi.fn((id: string) => ({
            id,
            path: `student_auth_credentials/${id}`,
          })),
        };
      }
      if (name === 'evaluations') {
        return {
          where: (...args: [string, string, unknown]) => makeQuery(evaluations).where(...args),
        };
      }
      if (name === 'course_fee_ledgers') {
        return {
          where: (...args: [string, string, unknown]) => makeQuery(ledgers).where(...args),
          doc: vi.fn((id: string) => ({ id, path: `course_fee_ledgers/${id}` })),
        };
      }
      if (name === 'users') {
        return {
          doc: vi.fn((id: string) => {
            const doc = users.find((userDoc) => userDoc.id === id);
            return {
              get: vi.fn(async () => ({
                exists: Boolean(doc),
                data: () => doc?.data() || {},
              })),
            };
          }),
          where: (...args: [string, string, unknown]) => makeQuery(users).where(...args),
        };
      }
      if (name === 'system_settings') {
        return {
          doc: vi.fn((id: string) => ({
            id,
            set: vi.fn(async () => undefined),
            get: vi.fn(async () => ({
              exists: id === 'holidays',
              data: () => (id === 'holidays' ? { dates: options.systemHolidays || [] } : {}),
            })),
          })),
        };
      }
      if (name === 'course_closing_records') {
        return {
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn(async () => makeDocumentStoreQuerySnapshot([])),
            })),
          })),
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn(async () => makeDocumentStoreQuerySnapshot([])),
            })),
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({
                  get: vi.fn(async () => makeDocumentStoreQuerySnapshot([])),
                })),
              })),
            })),
          })),
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({ exists: false })),
          })),
        };
      }
      return {};
    }),
  };

  return { db, batchOps, batches, classRefs, transactionWrites: transactionHarness.writes };
}

describe('/api/v1/classes save-holidays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
  });

  it('lets teachers add a holiday to their own classes on that weekday only', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@example.com',
    } as any);
    const mocked = mockClassesDb({
      classes: {
        'class-a': {
          name: 'A',
          teacherId: 'teacher-1',
          daysOfWeek: [1],
          startDate: '2026-06-01',
          endDate: '2026-07-06',
          grade: 3,
          holidays: [],
        },
        'class-b': {
          name: 'B',
          teacherId: 'teacher-1',
          daysOfWeek: [1, 3],
          startDate: '2026-06-01',
          endDate: '2026-07-06',
          grade: 3,
          holidays: ['2026-06-08'],
        },
        'class-c': {
          name: 'C',
          teacherId: 'teacher-2',
          daysOfWeek: [1],
          startDate: '2026-06-01',
          endDate: '2026-07-06',
          grade: 3,
          holidays: [],
        },
        'class-d': {
          name: 'D',
          teacherId: 'teacher-1',
          daysOfWeek: [2],
          startDate: '2026-06-02',
          endDate: '2026-07-07',
          grade: 3,
          holidays: [],
        },
      },
      users: [makeDoc('teacher-1', { role: 'teacher', displayName: 'Teacher 1' })],
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'save-holidays' },
        body: {
          classId: 'class-a',
          holidays: ['2026-06-15'],
          scope: 'teacher-all',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, affectedCount: 2 });
    expect(mocked.batchOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: expect.objectContaining({ path: 'classes/class-a' }),
          data: expect.objectContaining({ holidays: ['2026-06-15'] }),
        }),
        expect.objectContaining({
          ref: expect.objectContaining({ path: 'classes/class-b' }),
          data: expect.objectContaining({ holidays: ['2026-06-08', '2026-06-15'] }),
        }),
      ])
    );
    expect(mocked.batchOps.some((op) => String(op.ref.path || '') === 'classes/class-c')).toBe(
      false
    );
    expect(mocked.batchOps.some((op) => String(op.ref.path || '') === 'classes/class-d')).toBe(
      false
    );
  });

  it('extends active ongoing classes when admin saves system holidays', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T03:00:00Z'));
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
    const mocked = mockClassesDb({
      classes: {
        'active-ongoing': {
          name: 'Active ongoing',
          teacherId: 'teacher-1',
          status: 'active',
          daysOfWeek: [1],
          startDate: '2026-06-01',
          endDate: '2026-07-06',
          grade: 3,
          holidays: [],
        },
        'active-ended': {
          name: 'Active ended',
          teacherId: 'teacher-1',
          status: 'active',
          daysOfWeek: [1],
          startDate: '2026-01-05',
          endDate: '2026-02-09',
          grade: 3,
          holidays: [],
        },
        paused: {
          name: 'Paused',
          teacherId: 'teacher-1',
          status: 'paused',
          daysOfWeek: [1],
          startDate: '2026-06-01',
          endDate: '2026-07-06',
          grade: 3,
          holidays: [],
        },
        archived: {
          name: 'Archived',
          teacherId: 'teacher-1',
          status: 'archived',
          daysOfWeek: [1],
          startDate: '2026-06-01',
          endDate: '2026-07-06',
          grade: 3,
          holidays: [],
        },
        'different-day': {
          name: 'Different day',
          teacherId: 'teacher-1',
          status: 'active',
          daysOfWeek: [2],
          startDate: '2026-06-02',
          endDate: '2026-07-07',
          grade: 3,
          holidays: [],
        },
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'save-settings' },
        body: {
          settingType: 'holidays',
          dates: ['2026-06-15'],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, affectedClassCount: 1 });
    expect(mocked.batchOps).toEqual([
      expect.objectContaining({
        ref: expect.objectContaining({ path: 'classes/active-ongoing' }),
        data: expect.objectContaining({ endDate: '2026-09-21' }),
      }),
    ]);

    vi.useRealTimers();
  });
});

describe('/api/v1/classes status and promotion flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
    vi.mocked(getStudentCredentials).mockResolvedValue({
      loginPasswordSalt: 'student-salt',
      loginPasswordHash: 'student-hash',
      passwordVersion: 2,
      parentPasswordSalt: 'parent-salt',
      parentPasswordHash: 'parent-hash',
      parentPasswordVersion: 2,
    });
  });

  function enrollmentDocFor(
    profileId: string,
    classId: string,
    status: string,
    termStart = '2025-09-01'
  ) {
    const enrollmentId = makeStudentCourseEnrollmentId(profileId, classId, termStart);
    return makeDocumentStoreDocSnapshot({
      id: enrollmentId,
      path: `student_course_enrollments/${enrollmentId}`,
      data: {
        id: enrollmentId,
        studentId: profileId,
        classId,
        termStart,
        termEnd: '2025-12-31',
        status,
        joinedAt: termStart,
        endedAt: ['completed', 'transferred', 'dropped'].includes(status) ? '2025-12-31' : null,
        source: 'system',
        confidence: 'confirmed',
      },
    });
  }

  it('refuses to archive a class that still has an open enrollment', async () => {
    // Archiving used to stamp every active/on_leave student 'promoted' from
    // students.classId, which is exactly the write that produced a second
    // profile once that student needed a real next class. It now refuses
    // outright and leaves the roster to progressStudentToClass instead.
    const activeStudent = makeDoc('student-active', {
      classId: 'class-6',
      enrollmentStatus: 'active',
    });
    const mocked = mockClassesDb({
      classes: { 'class-6': { name: 'Grade 6', teacherId: 'teacher-1', status: 'active' } },
      students: [activeStudent],
      enrollments: [enrollmentDocFor('student-active', 'class-6', 'active')],
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'class-6', status: 'archived' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain('CLASS_HAS_OPEN_ENROLLMENTS');
    expect(mocked.batchOps).toEqual([]);
  });

  it('archives cleanly once every enrollment has already closed, writing no promoted status', async () => {
    const droppedStudent = makeDoc('student-dropped', {
      classId: 'class-6',
      enrollmentStatus: 'dropped',
    });
    const mocked = mockClassesDb({
      classes: { 'class-6': { name: 'Grade 6', teacherId: 'teacher-1', status: 'active' } },
      students: [droppedStudent],
      enrollments: [enrollmentDocFor('student-dropped', 'class-6', 'dropped')],
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'status' },
        body: { id: 'class-6', status: 'archived' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.statusSync).toEqual({ updatedStudents: 0 });
    expect(mocked.batchOps).toEqual([
      expect.objectContaining({
        type: 'update',
        ref: expect.objectContaining({ id: 'class-6' }),
        data: expect.objectContaining({ status: 'archived' }),
      }),
    ]);
    expect(mocked.batchOps.some((op) => op.data.enrollmentStatus === 'promoted')).toBe(false);
  });

  function completedSourceEnrollment(profileId: string) {
    // The id is the deterministic (student, class, termStart) tuple. A made-up
    // id is rejected by the enrollment validator, which is the point: the id is
    // how a retry finds the same record instead of creating a second one.
    const enrollmentId = makeStudentCourseEnrollmentId(profileId, 'class-6', '2025-09-01');
    return makeDocumentStoreDocSnapshot({
      id: enrollmentId,
      path: `student_course_enrollments/${enrollmentId}`,
      data: {
        id: enrollmentId,
        studentId: profileId,
        classId: 'class-6',
        termStart: '2025-09-01',
        termEnd: '2025-12-31',
        status: 'completed',
        joinedAt: '2025-09-01',
        endedAt: '2025-12-31',
        statusReason: null,
        source: 'system',
        confidence: 'confirmed',
        statusChangedAt: '2025-09-01T00:00:00.000Z',
        statusChangedBy: 'seed',
        confirmedAt: '2025-09-01T00:00:00.000Z',
        confirmedBy: 'seed',
        createdAt: '2025-09-01T00:00:00.000Z',
        updatedAt: '2025-09-01T00:00:00.000Z',
      },
    });
  }

  function importStudents(mocked: ReturnType<typeof mockClassesDb>) {
    vi.mocked(getDb).mockReturnValue(mocked.db);
    const res = mockRes();
    return handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'import-students' },
        body: { sourceClassId: 'class-6', targetClassId: 'class-7' },
      } as any,
      res
    ).then(() => res);
  }

  it('promotes the roster onto the same profile documents', async () => {
    const sourceStudent = makeDoc('old-student', {
      name: 'Student A',
      studentId: 'HS001',
      dob: '2012-01-01',
      contact: 'parent@example.com',
      classId: 'class-6',
      teacherId: 'teacher-1',
      grade: 6,
      enrollmentStatus: 'promoted',
    });
    const mocked = mockClassesDb({
      classes: {
        'class-7': {
          name: 'Grade 7',
          teacherId: 'teacher-2',
          status: 'active',
          grade: 7,
          startDate: '2026-01-05',
        },
      },
      students: [sourceStudent],
      enrollments: [completedSourceEnrollment('old-student')],
      users: [makeDoc('parent-1', { role: 'parent', studentId: 'old-student' })],
    });

    const res = await importStudents(mocked);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, importedCount: 1, failures: [] });
    // The claim that matters: no second students document anywhere.
    expect(
      mocked.batchOps.filter((op) => String(op.ref.path || '').startsWith('students/'))
    ).toEqual([]);
    expect(
      mocked.transactionWrites.filter(
        (write) =>
          write.type === 'create' && String((write.ref as any).path || '').startsWith('students/')
      )
    ).toEqual([]);
    expect(
      mocked.transactionWrites.some(
        (write) => String((write.ref as any).path || '') === 'students/old-student'
      )
    ).toBe(true);
  });

  it('stamps courseJoins at the target term start, not at today', async () => {
    // A roster import means "these students are in this course from its start".
    // A join date of today would mark the whole class not_enrolled for every
    // session between the course start and the import.
    const sourceStudent = makeDoc('old-student', {
      name: 'Student A',
      studentId: 'HS001',
      classId: 'class-6',
      teacherId: 'teacher-1',
      enrollmentStatus: 'promoted',
    });
    const mocked = mockClassesDb({
      classes: {
        'class-7': {
          name: 'Grade 7',
          teacherId: 'teacher-2',
          status: 'active',
          grade: 7,
          startDate: '2026-01-05',
          endDate: '2026-12-31',
        },
      },
      students: [sourceStudent],
      enrollments: [completedSourceEnrollment('old-student')],
    });

    const res = await importStudents(mocked);

    expect(res.statusCode).toBe(200);
    const profileWrite = mocked.transactionWrites.find(
      (write): write is Extract<typeof write, { data: unknown }> =>
        write.type !== 'delete' && String((write.ref as any).path || '') === 'students/old-student'
    );
    expect((profileWrite?.data as any).courseJoins).toEqual([
      { classId: 'class-7', termStart: '2026-01-05', joinedAt: '2026-01-05' },
    ]);
  });

  it('never copies credentials, because there is no second document to copy them to', async () => {
    const sourceStudent = makeDoc('old-student', {
      name: 'Student A',
      studentId: 'HS001',
      classId: 'class-6',
      teacherId: 'teacher-1',
      enrollmentStatus: 'promoted',
      faceImage: '',
      faceImageStoragePath: 'student_faces/teacher-1/old-student/face.jpg',
      customLoginPasswordSet: true,
      parentPasswordSet: true,
    });
    const mocked = mockClassesDb({
      classes: {
        'class-7': {
          name: 'Grade 7',
          teacherId: 'teacher-2',
          status: 'active',
          grade: 7,
          startDate: '2026-01-05',
        },
      },
      students: [sourceStudent],
      enrollments: [completedSourceEnrollment('old-student')],
    });

    await importStudents(mocked);

    const touched = [
      ...mocked.batchOps.map((op) => String(op.ref.path || '')),
      ...mocked.transactionWrites.map((write) => String((write.ref as any).path || '')),
    ];
    expect(touched.filter((path) => path.startsWith('student_auth_credentials/'))).toEqual([]);
    // The face image is untouched too: it belongs to a profile that never moved.
    const profileWrite = mocked.transactionWrites.find(
      (write): write is Extract<typeof write, { data: unknown }> =>
        write.type !== 'delete' && String((write.ref as any).path || '') === 'students/old-student'
    );
    expect(profileWrite?.data).not.toHaveProperty('faceImage');
  });

  it('reports an empty roster when the enrollment authority has nobody in the source class', async () => {
    // The profile still claims class-6. Reading that field is what promoted
    // students who had already left, so the roster ignores it.
    const sourceStudent = makeDoc('old-student', {
      name: 'Student A',
      studentId: 'HS001',
      classId: 'class-6',
      enrollmentStatus: 'promoted',
    });
    const mocked = mockClassesDb({
      classes: {
        'class-7': {
          name: 'Grade 7',
          teacherId: 'teacher-2',
          status: 'active',
          startDate: '2026-01-05',
        },
      },
      students: [sourceStudent],
      enrollments: [],
    });

    const res = await importStudents(mocked);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      eligibleCount: 0,
      importedCount: 0,
      skippedDuplicates: 0,
    });
    // The pass takes and releases a mutation lease whether or not it finds
    // anyone to move. That is operational bookkeeping, not a student write.
    expect(
      mocked.transactionWrites.filter(
        (write) =>
          !String((write.ref as { path?: string } | null)?.path ?? '').startsWith(
            '_maintenance/student_identity/active_mutations/'
          )
      )
    ).toEqual([]);
  });
});

describe('/api/v1/classes office academic permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@nancy.com',
    } as any);
  });

  it('lets office create a class assigned to a teacher with finance fields', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'class-new' });
    const mocked = mockClassesDb({
      classes: {},
      users: [makeDoc('office-uid', { role: 'office', displayName: 'Office' })],
    });
    mocked.db.collection = vi.fn((name: string) => {
      if (name === 'classes') {
        return {
          where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
          add,
          get: vi.fn().mockResolvedValue({ docs: [] }),
        };
      }
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              data: () => ({ role: 'office', displayName: 'Office' }),
            }),
          })),
        };
      }
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create' },
        body: {
          name: 'E101',
          teacherId: 'teacher-1',
          status: 'active',
          grade: 5,
          salaryPerSession: 500000,
          tuitionFee: 3000000,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ salaryPerSession: 500000, tuitionFee: 3000000 })
    );
    expect(touchRealtimeEvent).toHaveBeenCalledWith('payroll');
  });

  it('lets office update class finance fields', async () => {
    const mocked = mockClassesDb({
      classes: {
        'class-1': {
          name: 'E101',
          teacherId: 'teacher-1',
          status: 'active',
          salaryPerSession: 500000,
          tuitionFee: 3000000,
        },
      },
      users: [makeDoc('office-uid', { role: 'office', displayName: 'Office' })],
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        headers: {},
        query: { action: 'update' },
        body: {
          id: 'class-1',
          name: 'E102',
          teacherId: 'teacher-1',
          status: 'active',
          salaryPerSession: 1,
          tuitionFee: 1,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.batchOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'update',
          ref: expect.objectContaining({ id: 'class-1' }),
          data: expect.objectContaining({ salaryPerSession: 1, tuitionFee: 1 }),
        }),
      ])
    );
    expect(touchRealtimeEvent).toHaveBeenCalledWith('payroll');
  });

  it('stores weeklySessions and derives legacy schedule fields on create', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
    const mocked = mockClassesDb({
      users: [makeDoc('admin-uid', { role: 'admin', displayName: 'Admin' })],
      classes: {},
    });
    mocked.db.collection = vi.fn((name: string) => {
      if (name === 'classes') {
        return {
          where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
          add: vi.fn().mockImplementation(async (data) => {
            const id = 'class-new';
            (mocked.classRefs as any)[0] = { data: () => data };
            return { id };
          }),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        };
      }
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              data: () => ({ role: 'admin', displayName: 'Admin' }),
            }),
          })),
        };
      }
      return { where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create' },
        body: {
          name: 'G7 Split Time',
          teacherId: 'teacher-1',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          status: 'active',
          weeklySessions: [
            { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
            { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
          ],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(mocked.classRefs[0].data()).toMatchObject({
      currentCourseId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
      daysOfWeek: [1, 3],
      startTime: '17:30:00',
      schedule: '17:30 - 19:00',
      weeklySessions: [
        { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
        { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
      ],
    });
  });

  it('records the promotion link when a class is created from a source class', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
    const mocked = mockClassesDb({
      users: [makeDoc('admin-uid', { role: 'admin', displayName: 'Admin' })],
      classes: {},
    });
    mocked.db.collection = vi.fn((name: string) => {
      if (name === 'classes') {
        return {
          where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
          add: vi.fn().mockImplementation(async (data) => {
            (mocked.classRefs as any)[0] = { data: () => data };
            return { id: 'class-new' };
          }),
          // Promotion reads the freshly created target class to resolve its
          // term before it can enumerate a roster.
          doc: vi.fn((id: string) => ({
            id,
            path: `classes/${id}`,
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => (mocked.classRefs as any)[0]?.data() ?? {},
            }),
          })),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        };
      }
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              data: () => ({ role: 'admin', displayName: 'Admin' }),
            }),
          })),
        };
      }
      return {
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        })),
        doc: vi.fn((docId: string) => ({
          id: docId,
          path: `${name}/${docId}`,
          get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
        })),
      };
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create' },
        body: {
          name: 'G2 - Mr.Minh',
          teacherId: 'teacher-1',
          status: 'active',
          grade: 2,
          importSourceClassId: 'class-old',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(mocked.classRefs[0].data()).toMatchObject({
      importSourceClassId: 'class-old',
      promotedAt: 'serverTimestamp',
    });
  });

  it('leaves the promotion link unset for a class created from scratch', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
    const mocked = mockClassesDb({
      users: [makeDoc('admin-uid', { role: 'admin', displayName: 'Admin' })],
      classes: {},
    });
    mocked.db.collection = vi.fn((name: string) => {
      if (name === 'classes') {
        return {
          where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
          add: vi.fn().mockImplementation(async (data) => {
            (mocked.classRefs as any)[0] = { data: () => data };
            return { id: 'class-new' };
          }),
          // Promotion reads the freshly created target class to resolve its
          // term before it can enumerate a roster.
          doc: vi.fn((id: string) => ({
            id,
            path: `classes/${id}`,
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => (mocked.classRefs as any)[0]?.data() ?? {},
            }),
          })),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        };
      }
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              data: () => ({ role: 'admin', displayName: 'Admin' }),
            }),
          })),
        };
      }
      return {
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        })),
        doc: vi.fn((docId: string) => ({
          id: docId,
          path: `${name}/${docId}`,
          get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
        })),
      };
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create' },
        body: { name: 'Brand New', teacherId: 'teacher-1', status: 'active', grade: 2 },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(mocked.classRefs[0].data()).not.toHaveProperty('importSourceClassId');
    expect(mocked.classRefs[0].data()).not.toHaveProperty('promotedAt');
  });

  it('rejects weeklySessions with duplicate weekdays', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
    const mocked = mockClassesDb({
      users: [makeDoc('admin-uid', { role: 'admin', displayName: 'Admin' })],
      classes: {},
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create' },
        body: {
          name: 'Bad Split Time',
          teacherId: 'teacher-1',
          status: 'active',
          weeklySessions: [
            { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
            { dayOfWeek: 1, startTime: '19:15:00', endTime: '20:45:00' },
          ],
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toContain('Duplicate weekly session weekday');
  });
});

describe('/api/v1/classes reset-course', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
  });

  it('rejects reset-course dates that are not canonical API date-only values', async () => {
    const mocked = mockClassesDb({
      classes: {
        'class-1': {
          name: 'Reset Class',
          teacherId: 'teacher-1',
          status: 'active',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          tuitionFee: 1000000,
          terms: [],
        },
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'reset-course' },
        body: {
          classId: 'class-1',
          startDate: '01/06/2026',
          endDate: '2026-06-30',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(mocked.classRefs.get('class-1')?.update).not.toHaveBeenCalled();
  });
});

describe('/api/v1/classes generate-ledgers pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
  });

  it('pages classes when no classIds are provided instead of scanning every class', async () => {
    const classDocs = [
      {
        id: 'class-1',
        exists: true,
        ref: { id: 'class-1', path: 'classes/class-1' },
        data: () => ({
          status: 'active',
          tuitionFee: 1000,
          startDate: '2026-05-01',
          endDate: '2026-06-01',
        }),
      },
      {
        id: 'class-2',
        exists: true,
        ref: { id: 'class-2', path: 'classes/class-2' },
        data: () => ({
          status: 'active',
          tuitionFee: 2000,
          startDate: '2026-05-01',
          endDate: '2026-06-01',
        }),
      },
      {
        id: 'class-3',
        exists: true,
        ref: { id: 'class-3', path: 'classes/class-3' },
        data: () => ({
          status: 'active',
          tuitionFee: 3000,
          startDate: '2026-05-01',
          endDate: '2026-06-01',
        }),
      },
    ];
    const pageQuery: any = {
      startAfter: vi.fn(() => pageQuery),
      limit: vi.fn(() => pageQuery),
      get: vi.fn().mockResolvedValue({ docs: classDocs }),
    };
    const classesCollection: any = {
      doc: vi.fn((id: string) => ({ id, get: vi.fn().mockResolvedValue({ exists: false }) })),
      orderBy: vi.fn(() => pageQuery),
      get: vi.fn().mockResolvedValue({ docs: classDocs }),
    };
    const enrollmentsByClass: Record<string, ReturnType<typeof makeDoc>[]> = {
      'class-1': [
        makeDoc(makeStudentCourseEnrollmentId('student-1', 'class-1', '2026-05-01'), {
          studentId: 'student-1',
          classId: 'class-1',
          termStart: '2026-05-01',
          termEnd: '2026-06-01',
          status: 'active',
          joinedAt: '2026-05-01',
          endedAt: null,
          statusReason: null,
          source: 'system',
          confidence: 'confirmed',
        }),
      ],
      'class-2': [
        makeDoc(makeStudentCourseEnrollmentId('student-2', 'class-2', '2026-05-01'), {
          studentId: 'student-2',
          classId: 'class-2',
          termStart: '2026-05-01',
          termEnd: '2026-06-01',
          status: 'active',
          joinedAt: '2026-05-01',
          endedAt: null,
          statusReason: null,
          source: 'system',
          confidence: 'confirmed',
        }),
      ],
      'class-3': [
        makeDoc(makeStudentCourseEnrollmentId('student-3', 'class-3', '2026-05-01'), {
          studentId: 'student-3',
          classId: 'class-3',
          termStart: '2026-05-01',
          termEnd: '2026-06-01',
          status: 'active',
          joinedAt: '2026-05-01',
          endedAt: null,
          statusReason: null,
          source: 'system',
          confidence: 'confirmed',
        }),
      ],
    };
    const enrollmentsCollection: any = {
      where: vi.fn((field: string, op: string, value: string) => ({
        get: vi.fn().mockResolvedValue({ docs: enrollmentsByClass[value] || [] }),
      })),
    };
    const ledgersCollection: any = {
      where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
      doc: vi.fn((id: string) => ({ id, path: `course_fee_ledgers/${id}` })),
    };
    const batch = {
      create: vi.fn(),
      set: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ role: 'admin', displayName: 'Admin' }),
              }),
            })),
          };
        }
        if (name === 'classes') return classesCollection;
        if (name === 'student_course_enrollments') return enrollmentsCollection;
        if (name === 'course_fee_ledgers') return ledgersCollection;
        return {};
      }),
      batch: vi.fn(() => batch),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'generate-ledgers' },
        body: { batchSize: 2 },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(classesCollection.get).not.toHaveBeenCalled();
    expect(classesCollection.orderBy).toHaveBeenCalled();
    expect(pageQuery.limit).toHaveBeenCalledWith(3);
    expect(batch.create).toHaveBeenCalledTimes(2);
    expect(ledgersCollection.doc).not.toHaveBeenCalledWith(expect.stringContaining('class-3'));
    expect(res.body).toMatchObject({
      success: true,
      createdCount: 2,
      processedClasses: 2,
      cursor: 'class-2',
      hasMore: true,
      batchSize: 2,
    });
  });
});

describe('/api/v1/classes rebuild-student-counts pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
  });

  it('backfills one bounded class page and returns a continuation cursor', async () => {
    const classDocs = ['class-1', 'class-2', 'class-3'].map((id) => ({
      id,
      exists: true,
      ref: { id, path: `classes/${id}` },
      data: () => ({ name: id }),
    }));
    const pageQuery: any = {
      startAfter: vi.fn(() => pageQuery),
      limit: vi.fn(() => pageQuery),
      get: vi.fn().mockResolvedValue({ docs: classDocs }),
    };
    const classesCollection: any = {
      orderBy: vi.fn(() => pageQuery),
      get: vi.fn().mockResolvedValue({ docs: classDocs }),
    };
    const studentsByClass: Record<string, ReturnType<typeof makeDoc>[]> = {
      'class-1': [
        makeDoc('student-1', {
          classId: 'class-1',
          enrollmentStatus: 'active',
          studentLifecycle: 'trial',
        }),
        makeDoc('student-2', { classId: 'class-1', enrollmentStatus: 'on_leave' }),
      ],
      'class-2': [makeDoc('student-3', { classId: 'class-2', enrollmentStatus: 'dropped' })],
    };
    const batch = {
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ role: 'admin', displayName: 'Admin' }),
              }),
            })),
          };
        }
        if (name === 'classes') return classesCollection;
        if (name === 'students') {
          return {
            where: vi.fn((_field: string, _op: string, classId: string) => ({
              get: vi.fn().mockResolvedValue({ docs: studentsByClass[classId] || [] }),
            })),
          };
        }
        return {};
      }),
      batch: vi.fn(() => batch),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'rebuild-student-counts' },
        body: { batchSize: 2 },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(classesCollection.get).not.toHaveBeenCalled();
    expect(pageQuery.limit).toHaveBeenCalledWith(3);
    expect(batch.update).toHaveBeenCalledTimes(2);
    expect(batch.update).toHaveBeenNthCalledWith(
      1,
      classDocs[0].ref,
      expect.objectContaining({
        studentCounts: {
          total: 2,
          active: 1,
          trial: 1,
          onLeave: 1,
          dropped: 0,
          promoted: 0,
        },
        updatedAt: 'serverTimestamp',
      })
    );
    expect(res.body).toMatchObject({
      success: true,
      updatedClasses: 2,
      processedClasses: 2,
      cursor: 'class-2',
      hasMore: true,
      batchSize: 2,
    });
  });
});

function mockAvailabilityDb(options: {
  users: Record<string, Record<string, unknown>>;
  slots: Record<string, Record<string, unknown>>;
  profiles: Record<string, Record<string, unknown>>;
  requests: Record<string, Record<string, unknown>>;
}) {
  const users = options.users;
  const slots = { ...options.slots };
  const profiles = { ...options.profiles };
  const requests = { ...options.requests };

  const profileSets: Record<string, any> = {};
  const requestAdds: any[] = [];
  const requestUpdates: Record<string, any> = {};
  const slotSets: Record<string, any> = {};

  const db: any = {
    runTransaction: vi.fn(async (cb) => {
      const tx: any = {
        get: vi.fn(async (ref: any) => {
          if (ref.collectionName === 'teacher_availability_change_requests') {
            const data = requests[ref.id];
            return {
              exists: !!data,
              data: () => (data ? { ...data } : undefined),
            };
          }
          if (ref.collectionName === 'teacher_availability_profiles') {
            const data = profiles[ref.id] || profileSets[ref.id];
            return {
              exists: !!data,
              data: () => (data ? { ...data } : undefined),
            };
          }
          return { exists: false };
        }),
        set: vi.fn((ref: any, data: any, opts: any) => {
          if (ref.collectionName === 'teacher_availability_profiles') {
            profileSets[ref.id] = { ...profileSets[ref.id], ...data };
          }
        }),
        update: vi.fn((ref: any, data: any) => {
          if (ref.collectionName === 'teacher_availability_change_requests') {
            requestUpdates[ref.id] = { ...requests[ref.id], ...data };
            requests[ref.id] = { ...requests[ref.id], ...data };
          }
        }),
      };
      return await cb(tx);
    }),
    collection: vi.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: vi.fn((id: string) => {
            const data = users[id];
            return {
              get: vi.fn(async () => ({
                exists: !!data,
                data: () => (data ? { ...data } : undefined),
              })),
            };
          }),
        };
      }
      if (name === 'teacher_availability_slots') {
        return {
          doc: vi.fn((id?: string) => {
            const slotId = id || 'generated-slot-id';
            const data = slots[slotId];
            return {
              id: slotId,
              collectionName: 'teacher_availability_slots',
              get: vi.fn(async () => ({
                exists: !!data,
                data: () => (data ? { ...data } : undefined),
              })),
              set: vi.fn(async (val: any) => {
                slotSets[slotId] = val;
                slots[slotId] = val;
              }),
            };
          }),
        };
      }
      if (name === 'teacher_availability_profiles') {
        return {
          doc: vi.fn((id: string) => {
            const ref = { id, collectionName: 'teacher_availability_profiles' };
            const data = profiles[id];
            return {
              ...ref,
              get: vi.fn(async () => ({
                exists: !!data,
                data: () => (data ? { ...data } : undefined),
              })),
              set: vi.fn(async (val: any) => {
                profileSets[id] = val;
              }),
            };
          }),
        };
      }
      if (name === 'teacher_availability_change_requests') {
        return {
          where: vi.fn((field1: string, op1: string, val1: any) => {
            return {
              where: vi.fn((field2: string, op2: string, val2: any) => {
                return {
                  limit: vi.fn((n: number) => {
                    return {
                      get: vi.fn(async () => {
                        const list = Object.entries(requests)
                          .filter(([id, data]) => {
                            return data[field1] === val1 && data[field2] === val2;
                          })
                          .map(([id, data]) => ({
                            id,
                            data: () => data,
                          }));
                        return {
                          empty: list.length === 0,
                          docs: list.slice(0, n),
                        };
                      }),
                    };
                  }),
                };
              }),
            };
          }),
          add: vi.fn(async (val: any) => {
            const newId = `request-generated-${requestAdds.length + 1}`;
            const requestWithId = { id: newId, ...val };
            requestAdds.push(requestWithId);
            requests[newId] = requestWithId;
            return { id: newId };
          }),
          doc: vi.fn((id: string) => {
            const ref = { id, collectionName: 'teacher_availability_change_requests' };
            return ref;
          }),
        };
      }
      return {
        doc: vi.fn((id?: string) => ({ id: id || 'gen-id' })),
        add: vi.fn(async () => ({ id: 'audit-id' })),
      };
    }),
  };

  return { db, profileSets, requestAdds, requestUpdates, slotSets };
}

describe('/api/v1/classes teacher availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
  });

  it('creates the effective profile immediately on first teacher save', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 't@example.com',
    } as any);
    const mocked = mockAvailabilityDb({
      users: { 'teacher-1': { role: 'teacher', displayName: 'Teacher One' } },
      slots: {},
      profiles: {},
      requests: {},
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'save-availability' },
        body: { selections: [{ dayKey: 'tue', slotId: 'C' }] },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, mode: 'profile' });
    expect(mocked.profileSets['teacher-1']).toMatchObject({
      teacherId: 'teacher-1',
      teacherName: 'Teacher One',
      selections: [{ dayKey: 'tue', slotId: 'C' }],
      selectionKeys: ['tue:C'],
      version: 1,
    });
  });

  it('creates a pending request instead of changing an existing profile', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 't@example.com',
    } as any);
    const mocked = mockAvailabilityDb({
      users: { 'teacher-1': { role: 'teacher', displayName: 'Teacher One' } },
      slots: {},
      profiles: {
        'teacher-1': {
          teacherId: 'teacher-1',
          teacherName: 'Teacher One',
          selections: [{ dayKey: 'tue', slotId: 'C' }],
          selectionKeys: ['tue:C'],
          version: 1,
        },
      },
      requests: {},
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'save-availability' },
        body: {
          selections: [{ dayKey: 'wed', slotId: 'C' }],
          reason: 'New school schedule',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, mode: 'request' });
    expect(mocked.profileSets['teacher-1']).toBeUndefined();
    expect(mocked.requestAdds[0]).toMatchObject({
      teacherId: 'teacher-1',
      status: 'pending',
      reason: 'New school schedule',
      requestedSelections: [{ dayKey: 'wed', slotId: 'C' }],
    });
  });

  it('requires a reason for later teacher changes', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 't@example.com',
    } as any);
    const mocked = mockAvailabilityDb({
      users: { 'teacher-1': { role: 'teacher', displayName: 'Teacher One' } },
      slots: {},
      profiles: {
        'teacher-1': {
          teacherId: 'teacher-1',
          selections: [{ dayKey: 'tue', slotId: 'C' }],
          selectionKeys: ['tue:C'],
          version: 1,
        },
      },
      requests: {},
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'save-availability' },
        body: { selections: [{ dayKey: 'wed', slotId: 'C' }] },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('reason');
  });

  it('approves a pending request and updates the effective profile', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-1',
      email: 'admin@example.com',
    } as any);
    const mocked = mockAvailabilityDb({
      users: { 'admin-1': { role: 'admin', displayName: 'Admin One' } },
      slots: {},
      profiles: {
        'teacher-1': {
          teacherId: 'teacher-1',
          teacherName: 'Teacher One',
          selections: [{ dayKey: 'tue', slotId: 'C' }],
          selectionKeys: ['tue:C'],
          version: 1,
        },
      },
      requests: {
        'request-1': {
          teacherId: 'teacher-1',
          teacherName: 'Teacher One',
          requestedSelections: [{ dayKey: 'wed', slotId: 'C' }],
          status: 'pending',
        },
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'review-availability-change' },
        body: { requestId: 'request-1', decision: 'approved', reviewNote: 'Looks good' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, id: 'request-1', status: 'approved' });
    expect(mocked.profileSets['teacher-1']).toMatchObject({
      teacherId: 'teacher-1',
      version: 2,
      selections: [{ dayKey: 'wed', slotId: 'C' }],
      selectionKeys: ['wed:C'],
    });
    expect(mocked.requestUpdates['request-1']).toMatchObject({
      status: 'approved',
      reviewedBy: 'admin-1',
      reviewNote: 'Looks good',
    });
  });

  it('rejects a pending request without updating the effective profile', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-1',
      email: 'office@example.com',
    } as any);
    const mocked = mockAvailabilityDb({
      users: { 'office-1': { role: 'office', displayName: 'Office One' } },
      slots: {},
      profiles: {
        'teacher-1': {
          teacherId: 'teacher-1',
          teacherName: 'Teacher One',
          selections: [{ dayKey: 'tue', slotId: 'C' }],
          selectionKeys: ['tue:C'],
          version: 1,
        },
      },
      requests: {
        'request-1': {
          teacherId: 'teacher-1',
          teacherName: 'Teacher One',
          requestedSelections: [{ dayKey: 'wed', slotId: 'C' }],
          status: 'pending',
        },
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'review-availability-change' },
        body: { requestId: 'request-1', decision: 'rejected', reviewNote: 'No slots' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, id: 'request-1', status: 'rejected' });
    expect(mocked.profileSets['teacher-1']).toBeUndefined();
    expect(mocked.requestUpdates['request-1']).toMatchObject({
      status: 'rejected',
      reviewedBy: 'office-1',
      reviewNote: 'No slots',
    });
  });

  it('rejects fixed shifts outside the selected pair window', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 't@example.com',
    } as any);
    const mocked = mockAvailabilityDb({
      users: { 'teacher-1': { role: 'teacher', displayName: 'Teacher One' } },
      slots: {},
      profiles: {},
      requests: {},
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'save-availability' },
        body: { selections: [{ dayKey: 'tue', slotId: 'A1' }] },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('not allowed');
  });
});

describe('/api/v1/classes print request status actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockPrintRequestStatusDb({
    userRole,
    uid,
    request,
  }: {
    userRole: string;
    uid: string;
    request: Record<string, unknown>;
  }) {
    const txUpdate = vi.fn();
    const txGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => request,
    });
    const update = vi.fn().mockResolvedValue(undefined);
    const ref = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => request,
      }),
      update,
    };
    const runTransaction = vi.fn(async (callback: any) =>
      callback({
        get: txGet,
        update: txUpdate,
      })
    );
    const collection = vi.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              data: () => ({
                role: userRole,
                displayName: userRole === 'office' ? 'Office One' : 'Teacher One',
              }),
            }),
          })),
        };
      }
      if (name === 'print_requests') {
        return { doc: vi.fn(() => ref) };
      }
      return { doc: vi.fn() };
    });

    return { db: { collection, runTransaction }, runTransaction, txGet, txUpdate, update };
  }

  it('lets a teacher cancel only their pending print request', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 't@example.com',
    } as any);
    const mocked = mockPrintRequestStatusDb({
      userRole: 'teacher',
      uid: 'teacher-1',
      request: { teacherId: 'teacher-1', status: 'pending' },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'cancel-print-request' },
        body: { requestId: 'print-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.runTransaction).toHaveBeenCalled();
    expect(mocked.txUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'cancelled', cancelledAt: expect.any(String) })
    );
    expect(mocked.update).not.toHaveBeenCalled();
  });

  it('blocks teacher cancellation after office has printed', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 't@example.com',
    } as any);
    const mocked = mockPrintRequestStatusDb({
      userRole: 'teacher',
      uid: 'teacher-1',
      request: { teacherId: 'teacher-1', status: 'printed' },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'cancel-print-request' },
        body: { requestId: 'print-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('Only pending print requests can be cancelled');
    expect(mocked.txUpdate).not.toHaveBeenCalled();
  });

  it('lets office mark pending requests as printed', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-1',
      email: 'o@example.com',
    } as any);
    const mocked = mockPrintRequestStatusDb({
      userRole: 'office',
      uid: 'office-1',
      request: { status: 'pending' },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'update-print-request-status' },
        body: { requestId: 'print-1', status: 'printed' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.runTransaction).toHaveBeenCalled();
    expect(mocked.txUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'printed', printedAt: expect.any(String) })
    );
    expect(mocked.update).not.toHaveBeenCalled();
  });

  it('requires rejection reason when office rejects a print request', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-1',
      email: 'o@example.com',
    } as any);
    const mocked = mockPrintRequestStatusDb({
      userRole: 'office',
      uid: 'office-1',
      request: { status: 'pending' },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'update-print-request-status' },
        body: { requestId: 'print-1', status: 'rejected' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Rejection reason is required');
    expect(mocked.runTransaction).not.toHaveBeenCalled();
  });
});

type CourseClosingTestSeed = {
  classData?: Record<string, unknown>;
  students?: Array<{ id: string; data: Record<string, unknown> }>;
  evaluations?: Array<{
    id: string;
    data: Record<string, unknown>;
    updateTime?: string;
  }>;
  notifications?: Array<{ id: string; data: Record<string, unknown> }>;
};

function mockCourseClosingDb(seed: CourseClosingTestSeed = {}) {
  const classData: Record<string, unknown> = {
    name: 'Class 1',
    teacherId: 'teacher-1',
    currentCourseId: 'course-1',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    status: 'active',
    ...seed.classData,
  };
  const students = (
    seed.students ?? [{ id: 'student-1', data: { classId: 'class-1', enrollmentStatus: 'active' } }]
  ).map(({ id, data }) => makeDocumentStoreDocSnapshot({ id, path: `students/${id}`, data }));
  const evaluations = (
    seed.evaluations ?? [
      {
        id: 'evaluation-1',
        data: {
          classId: 'class-1',
          studentId: 'student-1',
          evaluationType: 'final',
          date: '2026-06-30',
        },
        updateTime: '2026-06-30T10:00:00.000Z',
      },
    ]
  ).map(({ id, data, updateTime }) =>
    makeDocumentStoreDocSnapshot({ id, path: `evaluations/${id}`, data, updateTime })
  );
  const notifications = (seed.notifications ?? []).map(({ id, data }) =>
    makeDocumentStoreDocSnapshot({ id, path: `zalo_notifications/${id}`, data })
  );
  const users: Record<string, Record<string, unknown>> = {
    'teacher-1': { role: 'teacher', displayName: 'Teacher One' },
    'teacher-2': { role: 'teacher', displayName: 'Teacher Two' },
    'admin-1': { role: 'admin', displayName: 'Admin One' },
    'office-1': { role: 'office', displayName: 'Office One' },
    'accounting-1': { role: 'accounting', displayName: 'Accounting One' },
    'student-user': { role: 'student', displayName: 'Student User' },
  };
  const transactionWrites: Array<{ ref: any; data: Record<string, unknown> }> = [];

  const classRef: any = {
    id: 'class-1',
    path: 'classes/class-1',
    collectionName: 'classes',
    get: vi.fn(async () =>
      makeDocumentStoreDocSnapshot({ id: 'class-1', path: 'classes/class-1', data: classData })
    ),
    update: vi.fn(async (data: Record<string, unknown>) => {
      Object.assign(classData, data);
    }),
  };

  // Reset Course archives evaluations and writes ledgers through batches.
  const batchOps: Array<{ type: string; ref: any; data: Record<string, unknown> }> = [];

  const makeFilteredQuery = (docs: any[], collectionName = 'unknown') => {
    const constraints: Array<[string, string, unknown]> = [];
    const query: any = {
      where: vi.fn((field: string, op: string, value: unknown) => {
        constraints.push([field, op, value]);
        return query;
      }),
      get: vi.fn(async () =>
        makeDocumentStoreQuerySnapshot(docs.filter((doc) => matches(doc.data() || {}, constraints)))
      ),
      // Ledger generation writes by deterministic document id, and the course
      // roster reads the profile behind each enrollment the same way — so a
      // seeded document has to answer here, not only through the query.
      doc: vi.fn((id: string) => {
        const seeded = docs.find((doc) => doc.id === id);
        return {
          id,
          path: `${collectionName}/${id}`,
          collectionName,
          get: vi.fn(async () =>
            seeded
              ? makeDocumentStoreDocSnapshot({
                  id,
                  exists: true,
                  path: `${collectionName}/${id}`,
                  data: seeded.data() || {},
                })
              : makeDocumentStoreDocSnapshot({ id, exists: false, path: `${collectionName}/${id}` })
          ),
        };
      }),
    };
    return query;
  };

  const enrollments = students.map((docSnap) => {
    const studentId = docSnap.id;
    const classId = String(docSnap.data()?.classId || 'class-1');
    return {
      get id() {
        const termStart = String(classData.startDate || '2026-06-01');
        return makeStudentCourseEnrollmentId(studentId, classId, termStart);
      },
      get path() {
        const termStart = String(classData.startDate || '2026-06-01');
        return `student_course_enrollments/${makeStudentCourseEnrollmentId(studentId, classId, termStart)}`;
      },
      data: () => {
        const termStart = String(classData.startDate || '2026-06-01');
        const termEnd = String(classData.endDate || '2026-06-30');
        return {
          studentId,
          classId,
          termStart,
          termEnd,
          status: 'active',
          joinedAt: termStart,
          endedAt: null,
          statusReason: null,
          source: 'system',
          confidence: 'confirmed',
        };
      },
    };
  });

  const db: any = {
    collection: vi.fn((name: string) => {
      if (name === 'classes') {
        return {
          doc: vi.fn((id: string) =>
            id === 'class-1'
              ? classRef
              : {
                  id,
                  path: `classes/${id}`,
                  get: vi.fn(async () =>
                    makeDocumentStoreDocSnapshot({ id, exists: false, path: `classes/${id}` })
                  ),
                }
          ),
        };
      }
      if (name === 'users') {
        return {
          doc: vi.fn((id: string) => ({
            get: vi.fn(async () =>
              makeDocumentStoreDocSnapshot({
                id,
                path: `users/${id}`,
                exists: Boolean(users[id]),
                data: users[id],
              })
            ),
          })),
        };
      }
      if (name === 'students') return makeFilteredQuery(students, name);
      if (name === 'student_course_enrollments') return makeFilteredQuery(enrollments, name);
      if (name === 'evaluations') return makeFilteredQuery(evaluations, name);
      if (name === 'zalo_notifications') return makeFilteredQuery(notifications, name);
      return makeFilteredQuery([], name);
    }),
    runTransaction: vi.fn(async (callback: (transaction: any) => Promise<unknown>) => {
      const transaction: any = {
        get: vi.fn(async (target: { get: () => Promise<unknown> }) => target.get()),
        update: vi.fn((ref: any, data: Record<string, unknown>) => {
          transactionWrites.push({ ref, data });
          if (ref.collectionName === 'classes') {
            for (const [key, value] of Object.entries(data)) {
              // Honour the FieldValue.delete() sentinel so tests observe removal.
              if (value === '__delete__') delete classData[key];
              else classData[key] = value;
            }
          }
          return transaction;
        }),
        set: vi.fn(() => transaction),
        delete: vi.fn(() => transaction),
      };
      return callback(transaction);
    }),
    batch: vi.fn(() => {
      const batch: any = {
        create: vi.fn((ref: any, data: Record<string, unknown>) => {
          batchOps.push({ type: 'create', ref, data });
          return batch;
        }),
        set: vi.fn((ref: any, data: Record<string, unknown>) => {
          batchOps.push({ type: 'set', ref, data });
          return batch;
        }),
        update: vi.fn((ref: any, data: Record<string, unknown>) => {
          batchOps.push({ type: 'update', ref, data });
          return batch;
        }),
        delete: vi.fn((ref: any) => {
          batchOps.push({ type: 'delete', ref, data: {} });
          return batch;
        }),
        commit: vi.fn(async () => undefined),
      };
      return batch;
    }),
  };

  return { db, classData, classRef, transactionWrites, batchOps };
}

function authCourseClosingAs(uid: string) {
  vi.mocked(verifyAuthToken).mockResolvedValue({ uid, email: `${uid}@test.com` } as any);
}

async function invokeCourseClosingAction(
  action: string,
  options: { method?: string; query?: Record<string, unknown>; body?: unknown } = {}
) {
  const res = mockRes();
  await handler(
    {
      method: options.method ?? 'POST',
      headers: {},
      query: { action, ...(options.query || {}) },
      body: options.body,
    } as any,
    res
  );
  return res;
}

describe('/api/v1/classes course closing approval APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
  });

  it('lets the assigned teacher, Admin, and Office read the canonical snapshot', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);

    for (const uid of ['teacher-1', 'admin-1', 'office-1']) {
      authCourseClosingAs(uid);
      const res = await invokeCourseClosingAction('course-closing-status', {
        method: 'GET',
        query: { classId: 'class-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        courseClosing: { courseId: 'course-1', status: 'ready_for_approval' },
      });
    }
  });

  it('rejects an unrelated teacher and unsupported roles from reading status', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);

    for (const uid of ['teacher-2', 'accounting-1', 'student-user']) {
      authCourseClosingAs(uid);
      const res = await invokeCourseClosingAction('course-closing-status', {
        method: 'GET',
        query: { classId: 'class-1' },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('lets the assigned teacher approve a complete required roster without a reason', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('teacher-1');

    const res = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.courseClosing).toMatchObject({ status: 'approved', approvalValid: true });
    expect(mocked.classData.courseClosing).toMatchObject({
      courseId: 'course-1',
      approval: {
        status: 'approved',
        source: 'teacher',
        approvedBy: 'teacher-1',
        approvedByRole: 'teacher',
      },
    });
  });

  it('creates and persists one stable course UUID when approving a legacy class', async () => {
    const mocked = mockCourseClosingDb({ classData: { currentCourseId: undefined } });
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('teacher-1');

    const res = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(mocked.classData.currentCourseId).toEqual(
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    );
    expect(mocked.classData.courseClosing).toMatchObject({
      courseId: mocked.classData.currentCourseId,
    });
  });

  it('rejects approval from an unrelated teacher', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('teacher-2');

    const res = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1' },
    });

    expect(res.statusCode).toBe(403);
    expect(mocked.transactionWrites).toHaveLength(0);
  });

  it('requires a trimmed Admin reason and records an admin approval source', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('admin-1');

    const rejected = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1', reason: '   ' },
    });
    expect(rejected.statusCode).toBe(400);

    const approved = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1', reason: '  Teacher unavailable  ' },
    });
    expect(approved.statusCode).toBe(200);
    expect(mocked.classData.courseClosing).toMatchObject({
      approval: {
        source: 'admin',
        approvedBy: 'admin-1',
        adminReason: 'Teacher unavailable',
      },
    });
  });

  it('rejects approval when the required roster is empty', async () => {
    const mocked = mockCourseClosingDb({ students: [] });
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('teacher-1');

    const res = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.errorCode).toBe('COURSE_CLOSING_NO_REQUIRED_STUDENTS');
    expect(res.body.courseClosing).toMatchObject({ status: 'no_required_students' });
  });

  it('rejects approval with missing final evaluations and returns the canonical snapshot', async () => {
    const mocked = mockCourseClosingDb({ evaluations: [] });
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('teacher-1');

    const res = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.errorCode).toBe('COURSE_CLOSING_EVALUATIONS_INCOMPLETE');
    expect(res.body.courseClosing).toMatchObject({
      status: 'missing_evaluations',
      missingEvaluationStudentIds: ['student-1'],
    });
  });

  it('is idempotent for the same actor and unchanged fingerprints', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('teacher-1');

    const first = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1' },
    });
    const second = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(mocked.transactionWrites).toHaveLength(1);
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledTimes(1);
  });

  it('allows only Admin to exempt a current student after valid approval with a reason', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);

    authCourseClosingAs('admin-1');
    const beforeApproval = await invokeCourseClosingAction('exempt-course-closing-student', {
      body: { classId: 'class-1', studentId: 'student-1', reason: 'Medical leave' },
    });
    expect(beforeApproval.statusCode).toBe(409);
    expect(beforeApproval.body.errorCode).toBe('COURSE_CLOSING_NOT_APPROVED');

    const approval = await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1', reason: 'Approve on behalf' },
    });
    expect(approval.statusCode).toBe(200);

    authCourseClosingAs('teacher-1');
    const teacherAttempt = await invokeCourseClosingAction('exempt-course-closing-student', {
      body: { classId: 'class-1', studentId: 'student-1', reason: 'Medical leave' },
    });
    expect(teacherAttempt.statusCode).toBe(403);

    authCourseClosingAs('admin-1');
    const emptyReason = await invokeCourseClosingAction('exempt-course-closing-student', {
      body: { classId: 'class-1', studentId: 'student-1', reason: '   ' },
    });
    expect(emptyReason.statusCode).toBe(400);

    const exempted = await invokeCourseClosingAction('exempt-course-closing-student', {
      body: { classId: 'class-1', studentId: 'student-1', reason: '  Medical leave  ' },
    });
    expect(exempted.statusCode).toBe(200);
    expect(exempted.body.courseClosing).toMatchObject({
      status: 'completed',
      exemptStudentCount: 1,
      exemptions: [{ studentId: 'student-1', reason: 'Medical leave', createdBy: 'admin-1' }],
    });
    expect(mocked.classData.courseClosing).toMatchObject({
      courseId: 'course-1',
      exemptions: [{ studentId: 'student-1', reason: 'Medical leave' }],
    });
    expect(touchRealtimeEvent).toHaveBeenCalledWith('course-closing', {
      targetId: 'class-1',
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      mocked.db,
      expect.objectContaining({
        metadata: expect.objectContaining({
          event: 'course_closing_student_exempted',
          classId: 'class-1',
          courseId: 'course-1',
          studentId: 'student-1',
          reason: 'Medical leave',
        }),
      })
    );

    const duplicate = await invokeCourseClosingAction('exempt-course-closing-student', {
      body: { classId: 'class-1', studentId: 'student-1', reason: 'Again' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(mocked.classData.courseClosing).toMatchObject({
      exemptions: [expect.objectContaining({ studentId: 'student-1' })],
    });
  });

  it('rejects an exemption for a student outside the current required roster', async () => {
    const mocked = mockCourseClosingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    authCourseClosingAs('admin-1');
    await invokeCourseClosingAction('approve-course-closing', {
      body: { classId: 'class-1', reason: 'Approve on behalf' },
    });

    const res = await invokeCourseClosingAction('exempt-course-closing-student', {
      body: { classId: 'class-1', studentId: 'student-2', reason: 'Not enrolled' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.errorCode).toBe('COURSE_CLOSING_STUDENT_EXEMPT');
  });
});

const RESET_OPERATION_ID = 'b3b14711-9e3e-4c20-a02f-6ff1e983e928';

/**
 * Seeds a class whose single required student has a final evaluation plus every
 * required send already recorded, i.e. a `completed` course-closing snapshot.
 */
function mockCompletedCourseDb(seed: CourseClosingTestSeed = {}) {
  return mockCourseClosingDb({
    classData: {
      tuitionFee: 1000000,
      terms: [],
      ...seed.classData,
    },
    notifications: seed.notifications ?? [
      {
        id: 'notif-eval',
        data: {
          classId: 'class-1',
          studentId: 'student-1',
          courseId: 'course-1',
          type: 'evaluation_notice',
          status: 'sent',
          evaluationId: 'evaluation-1',
          evaluationVersion: '2026-06-30T10:00:00.000Z',
        },
      },
      {
        id: 'notif-tuition',
        data: {
          classId: 'class-1',
          studentId: 'student-1',
          courseId: 'course-1',
          type: 'tuition_notice',
          status: 'sent',
        },
      },
    ],
    ...seed,
  });
}

/**
 * Approves through the real endpoint so the stored fingerprints are the exact
 * ones the reset guard recomputes.
 */
async function approveAsAssignedTeacher() {
  authCourseClosingAs('teacher-1');
  const res = await invokeCourseClosingAction('approve-course-closing', {
    body: { classId: 'class-1' },
  });
  expect(res.statusCode).toBe(200);
  return res;
}

describe('/api/v1/classes reset-course course closing gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
  });

  it('rejects a missing or malformed operationId before any write', async () => {
    for (const operationId of [undefined, '', 'not-a-uuid']) {
      const mocked = mockCompletedCourseDb();
      vi.mocked(getDb).mockReturnValue(mocked.db);
      authCourseClosingAs('admin-1');

      const res = await invokeCourseClosingAction('reset-course', {
        body: {
          classId: 'class-1',
          startDate: '2026-07-01',
          endDate: '2026-07-31',
          ...(operationId === undefined ? {} : { operationId }),
        },
      });

      expect(res.statusCode).toBe(400);
      expect(mocked.classRef.update).not.toHaveBeenCalled();
      expect(mocked.batchOps).toHaveLength(0);
    }
  });

  it.each(['admin-1', 'office-1', 'accounting-1'])(
    'performs no course-data writes when %s resets an incomplete course',
    async (uid) => {
      // No sent-notification evidence at all, so the snapshot cannot be completed.
      const mocked = mockCompletedCourseDb({ notifications: [] });
      vi.mocked(getDb).mockReturnValue(mocked.db);
      authCourseClosingAs(uid);

      const res = await invokeCourseClosingAction('reset-course', {
        body: {
          classId: 'class-1',
          startDate: '2026-07-01',
          endDate: '2026-07-31',
          operationId: RESET_OPERATION_ID,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.body.errorCode).toBe('COURSE_CLOSING_INCOMPLETE');
      expect(res.body.courseClosing).toMatchObject({ courseId: 'course-1' });
      expect(mocked.classRef.update).not.toHaveBeenCalled();
      expect(mocked.batchOps).toHaveLength(0);
      expect(mocked.classData.currentCourseId).toBe('course-1');
      expect(mocked.classData.terms).toEqual([]);
    }
  );

  it('archives, rotates the course, and clears approval when the course is completed', async () => {
    const mocked = mockCompletedCourseDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    await approveAsAssignedTeacher();
    authCourseClosingAs('admin-1');

    const res = await invokeCourseClosingAction('reset-course', {
      body: {
        classId: 'class-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        operationId: RESET_OPERATION_ID,
      },
    });

    expect(res.statusCode).toBe(200);

    const terms = mocked.classData.terms as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      courseId: 'course-1',
      resetOperationId: RESET_OPERATION_ID,
    });
    // The archived term keeps its own independent identifier.
    expect(terms[0].id).not.toBe('course-1');

    expect(mocked.classData.currentCourseId).toEqual(
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    );
    expect(mocked.classData.currentCourseId).not.toBe('course-1');
    expect(mocked.classData.courseClosing).toBeUndefined();
    expect(mocked.classData.startDate).toBe('2026-07-01');
  });

  it('snapshots the outgoing schedule into the archived term', async () => {
    const mocked = mockCompletedCourseDb({
      classData: {
        tuitionFee: 1_800_000,
        holidays: ['2026-06-19'],
        weeklySessions: [{ dayOfWeek: 2, startTime: '18:00' }],
        daysOfWeek: [2],
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);
    await approveAsAssignedTeacher();
    authCourseClosingAs('office-1');

    const res = await invokeCourseClosingAction('reset-course', {
      body: {
        classId: 'class-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        operationId: RESET_OPERATION_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    const [term] = mocked.classData.terms as Array<Record<string, unknown>>;
    expect(term).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      tuitionFee: 1_800_000,
      holidays: ['2026-06-19'],
      weeklySessions: [{ dayOfWeek: 2, startTime: '18:00' }],
      daysOfWeek: [2],
    });
    // Current holidays are cleared for the new course.
    expect(mocked.classData.holidays).toEqual([]);

    // Retry with same operationId does not change snapshot fee or duplicate term
    const retryRes = await invokeCourseClosingAction('reset-course', {
      body: {
        classId: 'class-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        operationId: RESET_OPERATION_ID,
      },
    });
    expect(retryRes.statusCode).toBe(200);
    expect(mocked.classData.terms).toHaveLength(1);
    expect((mocked.classData.terms as Array<Record<string, unknown>>)[0].tuitionFee).toBe(
      1_800_000
    );
  });

  it('creates ledgers for the new course period exactly once', async () => {
    const mocked = mockCompletedCourseDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    await approveAsAssignedTeacher();
    authCourseClosingAs('office-1');

    const res = await invokeCourseClosingAction('reset-course', {
      body: {
        classId: 'class-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        operationId: RESET_OPERATION_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    const ledgerWrites = mocked.batchOps.filter(
      (op) =>
        (op.type === 'set' || op.type === 'create') &&
        String(op.ref.path || '').startsWith('course_fee_ledgers/')
    );
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0].data).toMatchObject({
      studentId: 'student-1',
      classId: 'class-1',
      termStart: '2026-07-01',
      termEnd: '2026-07-31',
    });
  });

  it('archives outgoing evaluations into the term without moving them to the new course', async () => {
    const mocked = mockCompletedCourseDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    await approveAsAssignedTeacher();
    authCourseClosingAs('admin-1');

    const res = await invokeCourseClosingAction('reset-course', {
      body: {
        classId: 'class-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        operationId: RESET_OPERATION_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    const [term] = mocked.classData.terms as Array<Record<string, unknown>>;
    const evaluationWrites = mocked.batchOps.filter((op) =>
      String(op.ref.path || '').startsWith('evaluations/')
    );
    expect(evaluationWrites).toHaveLength(1);
    // The evaluation follows the archived term id, never the new course dates.
    expect(evaluationWrites[0].data).toMatchObject({
      termId: term.id,
      termStart: '2026-06-01',
      termEnd: '2026-06-30',
    });
    expect(evaluationWrites[0].data.date).not.toBe('2026-07-31');
  });

  it('returns the original result and writes nothing new when the same operationId retries', async () => {
    const mocked = mockCompletedCourseDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    await approveAsAssignedTeacher();
    authCourseClosingAs('admin-1');

    const body = {
      classId: 'class-1',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      operationId: RESET_OPERATION_ID,
    };

    const first = await invokeCourseClosingAction('reset-course', { body });
    const rotatedCourseId = mocked.classData.currentCourseId;
    const second = await invokeCourseClosingAction('reset-course', { body });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((mocked.classData.terms as unknown[]).length).toBe(1);
    // The retry must not rotate a second time.
    expect(mocked.classData.currentCourseId).toBe(rotatedCourseId);
  });

  it('routes the signed file action and rejects the obsolete binary preview action', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-1',
      email: 'admin@example.com',
    } as any);
    const mocked = mockClassesDb({
      classes: {},
      users: [makeDoc('admin-1', { role: 'admin', displayName: 'Admin' })],
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const monthRes = mockRes();
    await handler(
      { method: 'GET', headers: {}, query: { action: 'course-closing-record-month' } } as any,
      monthRes
    );
    expect(monthRes.statusCode).toBe(200);
    expect(monthRes.body).toMatchObject({ success: true });

    const recordsRes = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'course-closing-records', month: '2026-07' },
      } as any,
      recordsRes
    );
    expect(recordsRes.statusCode).toBe(200);
    expect(recordsRes.body).toMatchObject({ success: true, month: '2026-07' });

    const fileRes = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {
          action: 'course-closing-record-file',
          recordId: 'course-1__student-1',
          documentType: 'evaluation',
        },
      } as any,
      fileRes
    );
    expect(fileRes.statusCode).toBe(404);

    const rateLimitCallsAfterFile = vi.mocked(enforceRateLimit).mock.calls.length;
    const previewRes = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {
          action: 'course-closing-record-preview',
          recordId: 'course-1__student-1',
          documentType: 'evaluation',
        },
      } as any,
      previewRes
    );
    expect(previewRes.statusCode).toBe(404);
    expect(previewRes.body.error).toBe('Unknown classes action');
    expect(enforceRateLimit).toHaveBeenCalledTimes(rateLimitCallsAfterFile);
  });
});

describe('/api/v1/classes generate-ledgers mode handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStudentCredentials).mockResolvedValue({});
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
  });

  function seededDb() {
    const batch = { create: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
    const classDoc = {
      id: 'class-1',
      exists: true,
      data: () => ({ name: 'G3', status: 'active', tuitionFee: 900_000 }),
    };
    const enrollmentDoc = {
      id: makeStudentCourseEnrollmentId('s1', 'class-1', '2026-01-05'),
      data: () => ({
        studentId: 's1',
        classId: 'class-1',
        termStart: '2026-01-05',
        termEnd: '2026-06-05',
        status: 'active',
        joinedAt: '2026-01-05',
        endedAt: null,
        statusReason: null,
        source: 'system',
        confidence: 'confirmed',
      }),
    };
    return {
      batch,
      db: {
        batch: () => batch,
        collection: (name: string) => {
          if (name === 'users') {
            return {
              doc: () => ({
                get: async () => ({
                  exists: true,
                  data: () => ({ role: 'admin', displayName: 'Admin' }),
                }),
              }),
            };
          }
          if (name === 'classes') {
            return {
              orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [classDoc] }) }) }),
            };
          }
          if (name === 'student_course_enrollments') {
            return { where: () => ({ get: async () => ({ docs: [enrollmentDoc] }) }) };
          }
          return {
            where: () => ({ get: async () => ({ docs: [] }) }),
            doc: (id: string) => ({ id, get: async () => ({ exists: true, data: () => ({}) }) }),
          };
        },
      },
    };
  }

  it('never writes when previewing', async () => {
    const { db, batch } = seededDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'generate-ledgers' },
        body: { mode: 'preview' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe('preview');
    expect(res.body.createdCount).toBe(1);
    expect(res.body.totalAmount).toBe(900_000);
    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised mode instead of falling back to apply', async () => {
    const { db, batch } = seededDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'generate-ledgers' },
        body: { mode: 'preveiw' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('treats a missing mode as apply', async () => {
    const { db, batch } = seededDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, query: { action: 'generate-ledgers' }, body: {} } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe('apply');
    expect(batch.commit).toHaveBeenCalled();
  });
});

// enforceRateLimit is mocked at the top of this file, so a wrong budget passes
// every status-code assertion. Check the arguments themselves.
describe('/api/v1/classes generate-ledgers rate limit budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforceRateLimit).mockResolvedValue(true);
    vi.mocked(getStudentCredentials).mockResolvedValue({});
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: () => ({
        orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
        where: () => ({ get: async () => ({ docs: [] }) }),
        doc: (id: string) => ({ id, get: async () => ({ exists: false, data: () => undefined }) }),
      }),
      batch: () => ({ create: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) }),
    } as any);
  });

  async function callWith(action: string, body: Record<string, unknown>) {
    await handler({ method: 'POST', headers: {}, query: { action }, body } as any, mockRes());
    return vi.mocked(enforceRateLimit).mock.calls.at(-1)?.[3];
  }

  it('gives preview a wide budget on its own scope', async () => {
    expect(await callWith('generate-ledgers', { mode: 'preview' })).toMatchObject({
      scope: 'classes_ledger_preview',
      maxAttempts: 120,
    });
  });

  it('gives ledger apply 60 attempts on the shared mutation scope', async () => {
    expect(await callWith('generate-ledgers', { mode: 'apply' })).toMatchObject({
      scope: 'classes_mutation',
      maxAttempts: 60,
    });
  });

  it('leaves the other heavy mutations at 10', async () => {
    for (const action of ['reset-course', 'import-students', 'rebuild-student-counts']) {
      expect(await callWith(action, {})).toMatchObject({
        scope: 'classes_mutation',
        maxAttempts: 10,
      });
    }
  });
});
