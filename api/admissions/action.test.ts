import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import handler from '../../server/api/admissions/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { writeAuditLog } from '../../server/api/lib/logging/auditLog.js';
import { getUserRoleAndName } from '../../server/api/lib/http/helpers.js';
import { handleCorsPreflight } from '../../server/api/lib/http/cors.js';
import { enforceDocumentStoreReadBeforeWrite } from '../../test-utils/strictDocumentStoreTransaction.js';
import { resetCanonicalStudentReadControlCacheForTests } from '../../server/api/lib/student/canonicalStudentReadControl.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../../server/api/lib/maintenance/studentIdentityMaintenance.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
    delete: vi.fn(() => ({ __op: 'deleteField' })),
  },
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => {
  const getDb = vi.fn();
  const verifyAuthToken = vi.fn();
  const verifyAuthContext = vi.fn(async (req: any, res: any, requiredRoles: any) => {
    const decoded = await verifyAuthToken(req, res, requiredRoles);
    if (!decoded) return null;
    const db = getDb();
    const userInfo = await getUserRoleAndName(db, decoded.uid, decoded.email);
    return {
      decoded,
      context: {
        uid: decoded.uid,
        email: decoded.email,
        role: userInfo.role as any,
        name: userInfo.name,
      },
    };
  });
  return { getDb, verifyAuthToken, verifyAuthContext };
});

vi.mock('../../server/api/lib/http/helpers.js', () => {
  const getUserRoleAndName = vi.fn(async (db: any, uid: string, fallbackEmail?: string) => {
    try {
      const database = db || getDb();
      const userDoc = await database.collection('users').doc(uid).get();
      const data = userDoc.data() || {};
      return {
        role: data.role || 'admin',
        name: data.name || data.displayName || fallbackEmail || 'Admin',
      };
    } catch {
      return { role: 'admin', name: 'Admin' };
    }
  });
  return {
    getUserRoleAndName,
    sendApiError: vi.fn((res: any, err: any, fallback: string) =>
      res.status(err?.statusCode || 500).json({ success: false, error: err?.message || fallback })
    ),
    normalizeBody: vi.fn((b: any) => b || {}),
    withStatus: vi.fn((message: string, statusCode: number) => {
      const err = new Error(message);
      (err as any).statusCode = statusCode;
      return err;
    }),
  };
});

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

// Admissions behavior is the subject of this suite. Accounting projection
// rebuilds and snapshot invalidation have their own contract tests and need a
// complete DocumentStore, so keep that post-commit boundary explicit here.
vi.mock('../../server/api/lib/services/accountingStudentSummaryService.js', () => ({
  refreshAccountingStudentSummariesAfterCommit: vi.fn().mockResolvedValue({
    rebuilt: [],
    queued: [],
    failed: [],
  }),
}));

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
}));

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

function doc(id: string, data: Record<string, unknown>) {
  return {
    id,
    exists: true,
    ref: {
      update: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    },
    data: () => data,
  };
}

function emptyStudentQuery() {
  const query: any = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
  };
  return query;
}

describe('/api/v1/admissions/delete-pending identity transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStudentIdentityMaintenanceCacheForTests();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@example.com',
    } as any);
  });

  function buildDeletePendingDb(options: {
    retryIntoMaintenance?: boolean;
    canonicalLifecycle?: string;
  } = {}) {
    const snapshots = new Map<string, any>([
      [
        'student_profile_aliases/legacy-pending',
        doc('legacy-pending', {
          legacyProfileId: 'legacy-pending',
          canonicalProfileId: 'canonical-pending',
          mergeRunId: 'merge-1',
          reasonCode: 'profile_normalization',
          sourceFingerprint: 'fingerprint-1',
          createdBy: 'merge-bot',
        }),
      ],
      ['student_profile_aliases/canonical-pending', { exists: false, data: () => undefined }],
      [
        'students/canonical-pending',
        doc('canonical-pending', {
          name: 'Canonical Pending',
          studentId: 'HS260099',
          studentLifecycle: options.canonicalLifecycle ?? 'pending',
        }),
      ],
      [
        'students/legacy-pending',
        doc('legacy-pending', {
          studentLifecycle: 'archived',
          mergedIntoStudentId: 'canonical-pending',
        }),
      ],
    ]);
    const refs = new Map<string, any>();
    const refFor = (path: string) => {
      if (!refs.has(path)) {
        refs.set(path, {
          path,
          id: path.split('/').at(-1),
          get: vi.fn(async () => snapshots.get(path) ?? { exists: false, data: () => undefined }),
          delete: vi.fn(),
        });
      }
      return refs.get(path);
    };
    let maintenanceMode: 'normal' | 'read_only' = 'normal';
    const committedDeletes: string[] = [];
    const makeTx = () => {
      const stagedDeletes: string[] = [];
      const tx = enforceDocumentStoreReadBeforeWrite({
        get: vi.fn(async (target: any) => {
          if (target.path === '_maintenance/student_identity') {
            return {
              exists: true,
              data: () => ({
                mode: maintenanceMode,
                activeRunId: maintenanceMode === 'read_only' ? 'run-1' : null,
                migrationActorId: maintenanceMode === 'read_only' ? 'merge-bot' : null,
                generation: maintenanceMode === 'read_only' ? 2 : 1,
              }),
            };
          }
          return snapshots.get(target.path) ?? { exists: false, data: () => undefined };
        }),
        delete: vi.fn((target: any) => stagedDeletes.push(target.path)),
      });
      return { tx, stagedDeletes };
    };
    const db: any = {
      doc: vi.fn((path: string) => refFor(path)),
      collection: vi.fn((name: string) => ({
        doc: vi.fn((id: string) => refFor(`${name}/${id}`)),
        add: vi.fn().mockResolvedValue({ id: 'history-1' }),
      })),
      runTransaction: vi.fn(async (callback: any) => {
        const first = makeTx();
        const result = await callback(first.tx);
        if (!options.retryIntoMaintenance) {
          committedDeletes.push(...first.stagedDeletes);
          return result;
        }
        maintenanceMode = 'read_only';
        const retry = makeTx();
        const retryResult = await callback(retry.tx);
        committedDeletes.push(...retry.stagedDeletes);
        return retryResult;
      }),
    };
    refFor('students/legacy-pending');
    refFor('students/canonical-pending');
    return { db, refs, committedDeletes };
  }

  it('resolves an alias and deletes only the canonical pending profile in the guarded transaction', async () => {
    const mocked = buildDeletePendingDb();
    vi.mocked(getDb).mockReturnValue(mocked.db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'delete-pending' },
        body: { studentId: 'legacy-pending' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.committedDeletes).toEqual(['students/canonical-pending']);
    expect(mocked.refs.get('students/legacy-pending').delete).not.toHaveBeenCalled();
    expect(mocked.refs.get('students/canonical-pending').delete).not.toHaveBeenCalled();
  });

  it('aborts a retried transaction when maintenance activates before commit', async () => {
    const mocked = buildDeletePendingDb({ retryIntoMaintenance: true });
    vi.mocked(getDb).mockReturnValue(mocked.db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'delete-pending' },
        body: { studentId: 'legacy-pending' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('STUDENT_IDENTITY_MAINTENANCE');
    expect(mocked.committedDeletes).toEqual([]);
  });

  it('returns 409 and writes nothing when an alias resolves to a canonical non-pending profile', async () => {
    const mocked = buildDeletePendingDb({ canonicalLifecycle: 'trial' });
    vi.mocked(getDb).mockReturnValue(mocked.db);
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'delete-pending' },
        body: { studentId: 'legacy-pending' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'Student is not in pending state' });
    expect(mocked.committedDeletes).toEqual([]);
  });
});

describe('/api/v1/admissions/create-trial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@nancy.com',
    } as any);
  });

  it('creates a new trial student and class counters in one transaction', async () => {
    const classRef = {
      id: 'class-1',
      get: vi.fn().mockResolvedValue(
        doc('class-1', {
          teacherId: 'teacher-1',
          name: 'E101',
          startDate: '2026-01-05',
          endDate: '2026-03-31',
        })
      ),
    };
    const studentRef = { id: 'student-new' };
    const counterRef = { id: 'students_26' };
    const emptyStudentQuery: any = {
      where: vi.fn(() => emptyStudentQuery),
      orderBy: vi.fn(() => emptyStudentQuery),
      limit: vi.fn(() => emptyStudentQuery),
      get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
    };
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef
          ? { exists: true, data: () => ({ seq: 2 }) }
          : { docs: [], empty: true }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The code registry claim stages its ownership document with set().
      set: vi.fn(),
    };
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'students') {
          return { ...emptyStudentQuery, doc: vi.fn(() => studentRef), add: vi.fn() };
        }
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'student_course_enrollments') {
          return {
            where: vi.fn(() => emptyStudentQuery),
            doc: vi.fn((id: string) => ({ id })),
          };
        }
        if (name === 'admissions_history') return { add: vi.fn().mockResolvedValue({ id: 'h1' }) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-trial' },
        body: {
          name: 'New Trial Student',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          classId: 'class-1',
          joinedAt: '2026-02-10',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(tx.create).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({ studentLifecycle: 'trial', studentId: 'HS260003' })
    );
    const createdTrialData = tx.create.mock.calls.find(
      ([ref]) => ref === studentRef
    )?.[1] as Record<string, unknown>;
    expect(createdTrialData).not.toHaveProperty('enrollmentDate');
    expect(createdTrialData).toMatchObject({
      trialStartedAt: '2026-02-10T00:00:00.000Z',
      courseJoins: [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' }],
    });
    expect(createdTrialData.admittedAt).not.toBe('2026-02-10T00:00:00.000Z');
    expect(tx.update).toHaveBeenCalledWith(
      classRef,
      expect.objectContaining({
        'studentCounts.total': 'increment:1',
        'studentCounts.active': 'increment:1',
        'studentCounts.trial': 'increment:1',
      })
    );
  });

  it('reactivates a unique archived exact match as trial', async () => {
    const historical = doc('student-old', {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '0384072314',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      studentId: 'HS260001',
    });
    Object.assign(historical.ref, {
      id: 'student-old',
      get: vi.fn().mockResolvedValue(historical),
    });
    const classDoc = doc('class-1', {
      teacherId: 'teacher-1',
      name: 'E101',
      startDate: '2026-01-05',
      endDate: '2026-03-31',
    });
    const classRef = { id: 'class-1', get: vi.fn().mockResolvedValue(classDoc) };
    const tx = {
      get: vi.fn(async (target: any) =>
        typeof target.get === 'function' ? target.get() : { exists: false, data: () => ({}) }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The code registry claim stages its ownership document with set().
      set: vi.fn(),
    };
    const historyAdd = vi.fn().mockResolvedValue({ id: 'history-1' });
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn((path: string) =>
        path === 'students/student-old'
          ? historical.ref
          : { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }) }
      ),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn((id: string) => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  id === 'office-uid'
                    ? doc('office-uid', { role: 'office', displayName: 'Office' })
                    : { exists: false, data: () => ({}) }
                ),
            })),
          };
        }
        if (name === 'classes') {
          return { doc: vi.fn(() => classRef) };
        }
        if (name === 'students') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(function (this: any) {
                return this;
              }),
              get: vi.fn().mockResolvedValue({ docs: [historical], empty: false }),
            })),
            doc: vi.fn((id: string) => ({
              get: vi.fn().mockResolvedValue(id === 'student-old' ? historical : { exists: false }),
            })),
          };
        }
        if (name === 'student_course_enrollments') {
          const query: any = {
            where: vi.fn(() => query),
            orderBy: vi.fn(() => query),
            get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
            doc: vi.fn((id: string) => ({ id })),
          };
          return query;
        }
        if (name === 'admissions_history') return { add: historyAdd };
        return { add: vi.fn() };
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-trial' },
        body: {
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          classId: 'class-1',
          joinedAt: '2026-02-10',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.mode).toBe('reactivated');
    expect(tx.update).toHaveBeenCalledWith(
      historical.ref,
      expect.objectContaining({
        studentLifecycle: 'trial',
        trialReviewStatus: 'pending_sessions',
        classId: 'class-1',
        teacherId: 'teacher-1',
        admittedBy: 'office-uid',
        admittedAt: expect.any(String),
        trialStartedAt: '2026-02-10T00:00:00.000Z',
        courseJoins: [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' }],
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      classRef,
      expect.objectContaining({
        'studentCounts.total': 'increment:1',
        'studentCounts.active': 'increment:1',
        'studentCounts.trial': 'increment:1',
      })
    );
    expect(historyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reactivated_trial' })
    );
  });

  it('rejects exact matches in current lifecycle with 409', async () => {
    const current = doc('student-current', {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '0384072314',
      studentLifecycle: 'enrolled',
    });
    Object.assign(current.ref, {
      id: 'student-current',
      get: vi.fn().mockResolvedValue(current),
    });
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn((path: string) =>
        path === 'students/student-current'
          ? current.ref
          : { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }) }
      ),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('class-1', { teacherId: 'teacher-1' })),
            })),
          };
        }
        if (name === 'students') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(function (this: any) {
                return this;
              }),
              get: vi.fn().mockResolvedValue({ docs: [current], empty: false }),
            })),
          };
        }
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-trial' },
        body: {
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          classId: 'class-1',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
  });

  it('rejects multiple archived exact matches even when one record is explicitly selected', async () => {
    const first = doc('student-old-1', {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '0384072314',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
    });
    const second = doc('student-old-2', {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '0384072314',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
    });
    Object.assign(first.ref, {
      id: 'student-old-1',
      get: vi.fn().mockResolvedValue(first),
    });
    Object.assign(second.ref, {
      id: 'student-old-2',
      get: vi.fn().mockResolvedValue(second),
    });
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn((path: string) => {
        if (path === 'students/student-old-1') return first.ref;
        if (path === 'students/student-old-2') return second.ref;
        return { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }) };
      }),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('class-1', { teacherId: 'teacher-1' })),
            })),
          };
        }
        if (name === 'students') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(function (this: any) {
                return this;
              }),
              get: vi.fn().mockResolvedValue({ docs: [first, second], empty: false }),
            })),
          };
        }
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-trial' },
        body: {
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          classId: 'class-1',
          selectedHistoricalStudentId: 'student-old-1',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(first.ref.update).not.toHaveBeenCalled();
  });

  it('rejects selecting an archived record that is not a candidate match', async () => {
    const unrelated = doc('student-unrelated', {
      name: 'Unrelated Student',
      dob: '2014-01-01',
      contact: '0900000000',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      studentId: 'HS260099',
    });
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('class-1', { teacherId: 'teacher-1' })),
            })),
          };
        }
        if (name === 'students') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(function (this: any) {
                return this;
              }),
              get: vi.fn().mockResolvedValue({ docs: [unrelated], empty: false }),
            })),
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(unrelated) })),
          };
        }
        if (name === 'admissions_history') return { add: vi.fn().mockResolvedValue({ id: 'h1' }) };
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-trial' },
        body: {
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          classId: 'class-1',
          selectedHistoricalStudentId: 'student-unrelated',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(unrelated.ref.update).not.toHaveBeenCalled();
  });

  it('records explicit selection when office reactivates an archived possible match', async () => {
    const candidate = doc('student-possible', {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '0900000000',
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      studentId: 'HS260099',
    });
    Object.assign(candidate.ref, {
      id: 'student-possible',
      get: vi.fn().mockResolvedValue(candidate),
    });
    const historyAdd = vi.fn().mockResolvedValue({ id: 'history-1' });
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn((path: string) =>
        path === 'students/student-possible'
          ? candidate.ref
          : { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }) }
      ),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(
                doc('class-1', {
                  teacherId: 'teacher-1',
                  startDate: '2026-01-05',
                  endDate: '2026-12-31',
                })
              ),
            })),
          };
        }
        if (name === 'students') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(function (this: any) {
                return this;
              }),
              get: vi.fn().mockResolvedValue({ docs: [candidate], empty: false }),
            })),
          };
        }
        if (name === 'student_course_enrollments') {
          const query: any = {
            where: vi.fn(() => query),
            orderBy: vi.fn(() => query),
            get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
            doc: vi.fn((id: string) => ({ id })),
          };
          return query;
        }
        if (name === 'admissions_history') return { add: historyAdd };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) =>
        callback({
          get: vi.fn(async (target: any) =>
            typeof target.get === 'function' ? target.get() : { exists: false, data: () => ({}) }
          ),
          update: vi.fn(),
          create: vi.fn(),
        })
      ),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-trial' },
        body: {
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          classId: 'class-1',
          selectedHistoricalStudentId: 'student-possible',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(historyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'possible_match_selected' })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          admissionMode: 'reactivated',
          selectedHistoricalStudentId: 'student-possible',
        }),
      })
    );
  });

  it('clears a pending note and increments class counters in canonical_required mode', async () => {
    const pending = doc('pending-1', {
      name: 'Pending Student',
      dob: '2014-01-01',
      contact: '0384072314',
      grade: 6,
      studentId: 'HS260099',
      studentLifecycle: 'pending',
      admissionStatus: 'pending',
      note: 'Wants grade 6 evening class',
    });
    const classDoc = doc('class-1', {
      teacherId: 'teacher-1',
      name: 'E101',
      startDate: '2026-01-05',
      endDate: '2026-03-31',
    });
    const classRef = { id: 'class-1', get: vi.fn().mockResolvedValue(classDoc) };
    const studentRef = {
      ...pending.ref,
      id: 'pending-1',
      get: vi.fn().mockResolvedValue(pending),
    };
    const tx = {
      get: vi.fn(async (target: any) =>
        typeof target?.get === 'function'
          ? target.get()
          : { exists: false, docs: [], empty: true, data: () => ({}) }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The code registry claim stages its ownership document with set().
      set: vi.fn(),
    };
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn((path: string) => {
        if (path === 'students/pending-1') return studentRef;
        if (path === '_maintenance/student_identity_read_model') {
          return {
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ schemaVersion: 1, mode: 'canonical_required', generation: 1 }),
            }),
          };
        }
        return { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }) };
      }),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn((id: string) => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  id === 'office-uid'
                    ? doc('office-uid', { role: 'office', displayName: 'Office' })
                    : { exists: false, data: () => ({}) }
                ),
            })),
          };
        }
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'student_course_enrollments') {
          const query: any = {
            where: vi.fn(() => query),
            orderBy: vi.fn(() => query),
            get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
            doc: vi.fn((id: string) => ({
              id,
              get: vi.fn().mockResolvedValue({ id, exists: false, data: () => ({}) }),
            })),
          };
          return query;
        }
        if (name === 'admissions_history') return { add: vi.fn().mockResolvedValue({ id: 'h1' }) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-trial' },
        body: {
          pendingStudentId: 'pending-1',
          classId: 'class-1',
          joinedAt: '2026-02-10',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const studentUpdate = tx.update.mock.calls.find(([ref]: any[]) => ref === studentRef)?.[1];
    expect(studentUpdate).toEqual(
      expect.objectContaining({
        studentLifecycle: 'trial',
        note: expect.objectContaining({ __op: 'deleteField' }),
        classId: expect.objectContaining({ __op: 'deleteField' }),
        teacherId: expect.objectContaining({ __op: 'deleteField' }),
        enrollmentStatus: expect.objectContaining({ __op: 'deleteField' }),
        trialStartedAt: '2026-02-10T00:00:00.000Z',
        courseJoins: [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' }],
      })
    );
    expect(tx.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        studentId: 'pending-1',
        classId: 'class-1',
        joinedAt: '2026-02-10',
        status: 'trial',
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      classRef,
      expect.objectContaining({
        'studentCounts.total': 'increment:1',
        'studentCounts.active': 'increment:1',
        'studentCounts.trial': 'increment:1',
      })
    );
  });
});

describe('/api/v1/admissions/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@nancy.com',
    } as any);
  });

  it('stores a trimmed optional note when adding a pending student', async () => {
    const studentRef = { id: 'pending-1' };
    const counterRef = { id: 'students_26' };
    const studentQuery = emptyStudentQuery();
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef
          ? { exists: true, data: () => ({ seq: 98 }) }
          : { docs: [], empty: true }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The code registry claim stages its ownership document with set().
      set: vi.fn(),
    };
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'students') return { ...studentQuery, doc: vi.fn(() => studentRef) };
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'admissions_history') return { add: vi.fn().mockResolvedValue({ id: 'h1' }) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'add-to-waitlist' },
        body: {
          name: 'Pending Student',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          note: '  Wants grade 6 evening class  ',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(tx.create).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({
        studentLifecycle: 'pending',
        studentId: 'HS260099',
        note: 'Wants grade 6 evening class',
      })
    );
  });

  it('returns pending waitlist notes for office placement', async () => {
    const pending = doc('pending-1', {
      name: 'Pending Student',
      studentId: 'HS260099',
      dob: '2014-01-01',
      contact: '0384072314',
      grade: 6,
      createdAt: '2026-06-02T08:00:00.000Z',
      note: 'Wants grade 6 evening class',
    });
    const pendingQuery: any = {
      where: vi.fn(() => pendingQuery),
      get: vi.fn().mockResolvedValue({ docs: [pending] }),
    };
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'students') return pendingQuery;
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'list-pending' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.students[0]).toMatchObject({
      id: 'pending-1',
      note: 'Wants grade 6 evening class',
    });
  });
});

describe('/api/v1/admissions/search-historical', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@nancy.com',
    } as any);
  });

  it('returns each match with status and latest class context', async () => {
    const candidate = doc('student-current', {
      name: 'Nguyen Van A',
      studentId: 'HS260001',
      dob: '2014-01-01',
      contact: '0384072314',
      classId: 'class-1',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    });
    const studentQuery: any = {
      limit: vi.fn(() => studentQuery),
      get: vi.fn().mockResolvedValue({ docs: [candidate], empty: false }),
    };
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'students') {
          return {
            where: vi.fn(() => studentQuery),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn((id: string) => ({
              get: vi
                .fn()
                .mockResolvedValue(id === 'class-1' ? doc('class-1', { name: 'E101' }) : null),
            })),
          };
        }
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {
          action: 'search-historical',
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.exactMatches[0]).toMatchObject({
      id: 'student-current',
      data: expect.objectContaining({
        name: 'Nguyen Van A',
        studentId: 'HS260001',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      }),
      latestClassId: 'class-1',
      latestClassName: 'E101',
    });
  });
});

describe('/api/v1/admissions/trial-decision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCanonicalStudentReadControlCacheForTests();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@nancy.com',
    } as any);
  });
  afterEach(() => resetCanonicalStudentReadControlCacheForTests());

  function trialDecisionDb(
    student: Record<string, unknown>,
    attendance: Array<Record<string, unknown>> = [],
    options: {
      strictTransaction?: boolean;
      openEnrollment?: boolean;
      readMode?: 'legacy_compare' | 'canonical_preferred' | 'canonical_required';
    } = {}
  ) {
    const studentDoc = doc('trial-student', student);
    const attendanceQuery: any = {
      where: vi.fn(() => attendanceQuery),
      get: vi.fn().mockResolvedValue({
        docs: attendance.map((data, index) => doc(`attendance-${index}`, data)),
      }),
    };
    const enrollmentRef = { id: 'trial-enrollment-1' };
    const enrollmentQuery: any = {
      where: vi.fn(() => enrollmentQuery),
      orderBy: vi.fn(() => enrollmentQuery),
      doc: vi.fn(() => enrollmentRef),
    };
    const enrollmentDoc = {
      id: 'trial-enrollment-1',
      data: () => ({
        id: 'WyJ0cmlhbC1zdHVkZW50IiwiY2xhc3MtMSIsIjIwMjYtMDUtMDEiXQ',
        studentId: 'trial-student',
        classId: 'class-1',
        termStart: '2026-05-01',
        termEnd: null,
        status: 'trial',
        joinedAt: '2026-05-01',
        endedAt: null,
        statusReason: null,
        source: 'system',
        confidence: 'confirmed',
        statusChangedAt: '2026-05-01T00:00:00.000Z',
        statusChangedBy: 'teacher-1',
        confirmedAt: '2026-05-01T00:00:00.000Z',
        confirmedBy: 'teacher-1',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      }),
    };
    const studentRef = {
      id: 'trial-student',
      get: vi.fn().mockResolvedValue(studentDoc),
      update: studentDoc.ref.update,
    };
    const classRef = {
      id: 'class-1',
      get: vi.fn().mockResolvedValue(doc('class-1', { teacherId: 'teacher-1' })),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if ((options.openEnrollment ?? true) && target === enrollmentQuery) {
          return { docs: [enrollmentDoc], empty: false };
        }
        return typeof target.get === 'function'
          ? target.get()
          : { exists: false, data: () => ({}) };
      }),
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const transaction = options.strictTransaction ? enforceDocumentStoreReadBeforeWrite(tx) : tx;
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case. The
      // canonical resolver's own profile lookup arrives this way too, so
      // students/trial-student has to route to the same studentRef the
      // collection-style lookups use.
      doc: vi.fn((path: string) => {
        if (path === 'students/trial-student') return studentRef;
        if (path === '_maintenance/student_identity_read_model' && options.readMode) {
          return {
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ schemaVersion: 1, mode: options.readMode, generation: 1 }),
            }),
          };
        }
        return { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }) };
      }),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('teacher-1', { role: 'teacher' })),
            })),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => studentRef),
          };
        }
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'attendance') return attendanceQuery;
        if (name === 'student_course_enrollments') return enrollmentQuery;
        if (name === 'admissions_history') return { add: vi.fn().mockResolvedValue({ id: 'h1' }) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(transaction)),
    };
    return { db, studentDoc, studentRef, classRef, tx: transaction };
  }

  it('rejects a decision until the trial has enough attended sessions', async () => {
    const mocked = trialDecisionDb({
      classId: 'class-1',
      teacherId: 'teacher-1',
      studentLifecycle: 'trial',
      trialReviewStatus: 'pending_sessions',
      trialRequiredSessions: 2,
    });
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'trial-decision' },
        body: { studentId: 'trial-student', decision: 'accepted' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(mocked.studentDoc.ref.update).not.toHaveBeenCalled();
  });

  it('allows the assigned teacher to accept a trial after two attended sessions', async () => {
    const mocked = trialDecisionDb(
      {
        classId: 'class-1',
        teacherId: 'teacher-1',
        studentLifecycle: 'trial',
        trialReviewStatus: 'pending_teacher_review',
        trialRequiredSessions: 2,
        trialStartedAt: '2026-05-01T00:00:00.000Z',
        createdAt: '2026-05-01T00:00:02.000Z',
        enrollmentDate: '2026-05-01T00:00:05.000Z',
      },
      [
        { studentId: 'trial-student', classId: 'class-1', date: '2026-05-20', status: 'present' },
        { studentId: 'trial-student', classId: 'class-1', date: '2026-05-21', status: 'late' },
      ],
      { strictTransaction: true }
    );
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'trial-decision' },
        body: { studentId: 'trial-student', decision: 'accepted' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.studentRef,
      expect.objectContaining({
        studentLifecycle: 'enrolled',
        trialSessionCount: 2,
        enrollmentDate: 'serverTimestamp',
      })
    );
    const studentUpdate = mocked.tx.update.mock.calls.find(
      ([ref]: any[]) => ref === mocked.studentRef
    )?.[1];
    expect(studentUpdate).not.toHaveProperty('trialDecisionNote');
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.classRef,
      expect.objectContaining({ 'studentCounts.trial': 'increment:-1' })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ decision: 'accepted', trialSessionCount: 2 }),
      })
    );
  });

  it('revokes a rejected trial and removes it from class counters atomically', async () => {
    const mocked = trialDecisionDb(
      {
        classId: 'class-1',
        teacherId: 'teacher-1',
        studentLifecycle: 'trial',
        enrollmentStatus: 'active',
        trialReviewStatus: 'pending_teacher_review',
        trialRequiredSessions: 1,
      },
      [{ studentId: 'trial-student', classId: 'class-1', date: '2026-05-21', status: 'present' }],
      {
        strictTransaction: true,
        openEnrollment: true,
      }
    );
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'trial-decision' },
        body: { studentId: 'trial-student', decision: 'rejected' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.studentRef,
      expect.objectContaining({
        studentLifecycle: 'archived',
        archiveReason: 'trial_rejected',
        enrollmentStatus: expect.objectContaining({ __op: 'deleteField' }),
        isRevoked: true,
      })
    );
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.classRef,
      expect.objectContaining({
        'studentCounts.total': 'increment:-1',
        'studentCounts.active': 'increment:-1',
        'studentCounts.trial': 'increment:-1',
      })
    );
    expect(mocked.tx.update).not.toHaveBeenCalledWith(
      mocked.classRef,
      expect.objectContaining({ 'studentCounts.dropped': expect.anything() })
    );
    expect(mocked.tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'trial-enrollment-1' }),
      expect.objectContaining({ status: 'dropped' })
    );
  });

  it('deletes legacy relationship projections when accepting in canonical_required mode', async () => {
    const mocked = trialDecisionDb(
      {
        classId: 'class-1',
        teacherId: 'teacher-1',
        trialClassId: 'class-1',
        trialTeacherId: 'teacher-1',
        enrollmentStatus: 'active',
        studentLifecycle: 'trial',
        trialReviewStatus: 'pending_teacher_review',
        trialRequiredSessions: 1,
      },
      [{ studentId: 'trial-student', classId: 'class-1', date: '2026-05-21', status: 'present' }],
      { readMode: 'canonical_required', strictTransaction: true }
    );
    vi.mocked(getDb).mockReturnValue(mocked.db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'trial-decision' },
        body: { studentId: 'trial-student', decision: 'accepted' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.tx.update).toHaveBeenCalledWith(
      mocked.studentRef,
      expect.objectContaining({
        classId: expect.objectContaining({ __op: 'deleteField' }),
        teacherId: expect.objectContaining({ __op: 'deleteField' }),
        enrollmentStatus: expect.objectContaining({ __op: 'deleteField' }),
      })
    );
  });
});

describe('/api/v1/admissions/recent', () => {
  it('returns current student and class state for the admissions timeline', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@nancy.com',
    } as any);
    const query: any = {
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({
        docs: [
          doc('history-1', {
            action: 'created_trial',
            studentId: 'student-1',
            classId: 'class-1',
            trialSessionCount: 1,
          }),
        ],
      }),
    };
    const db: any = {
      getAll: vi.fn(async (...refs: any[]) => {
        return Promise.all(refs.map(async (ref) => ref.get()));
      }),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'admissions_history') return query;
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(
                doc('student-1', {
                  name: 'Trial Student',
                  studentLifecycle: 'trial',
                  trialReviewStatus: 'pending_sessions',
                  trialSessionCount: 2,
                  trialRequiredSessions: 2,
                })
              ),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('class-1', { name: 'E101' })),
            })),
          };
        }
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'recent' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.admissions[0]).toMatchObject({
      studentName: 'Trial Student',
      className: 'E101',
      studentLifecycle: 'trial',
      trialReviewStatus: 'pending_sessions',
      trialSessionCount: 2,
      trialRequiredSessions: 2,
    });
  });

  it('uses verified auth context without reading user role/name again', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'office-uid', email: 'office@example.com' } as any,
      context: {
        uid: 'office-uid',
        email: 'office@example.com',
        role: 'office',
        name: 'Office User',
      },
    });
    vi.mocked(getUserRoleAndName).mockClear();

    const createAdmissionsDbMock = () => {
      const query: any = {
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
      };
      return {
        collection: vi.fn((name: string) => {
          if (name === 'admissions_history') return query;
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false }),
            })),
          };
        }),
      };
    };
    const db = createAdmissionsDbMock();
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        query: { action: 'recent' },
        headers: { authorization: 'Bearer token' },
      } as any,
      res as any
    );

    expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'office']);
    expect(getUserRoleAndName).not.toHaveBeenCalled();
  });

  it('uses shared CORS preflight handling instead of wildcard headers', async () => {
    vi.clearAllMocks();
    const res = mockRes();
    vi.mocked(handleCorsPreflight).mockReturnValueOnce(true);

    await handler({ method: 'OPTIONS', query: { action: 'recent' }, headers: {} } as any, res);

    expect(handleCorsPreflight).toHaveBeenCalledWith(expect.anything(), res);
    expect(res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(verifyAuthContext).not.toHaveBeenCalled();
  });
});

describe('/api/v1/admissions/create-trial joinedAt boundaries', () => {
  const endedCourse = {
    teacherId: 'teacher-1',
    name: 'E101',
    startDate: '2026-01-05',
    endDate: '2026-03-31',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-uid',
      email: 'office@nancy.com',
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildDb() {
    const classRef = {
      id: 'class-ended',
      get: vi.fn().mockResolvedValue(doc('class-ended', endedCourse)),
    };
    const studentRef = { id: 'student-new' };
    const counterRef = { id: 'students_26' };
    const emptyQuery: any = {
      where: vi.fn(() => emptyQuery),
      orderBy: vi.fn(() => emptyQuery),
      limit: vi.fn(() => emptyQuery),
      get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
    };
    const tx = {
      get: vi.fn(async (target: any) =>
        target === counterRef
          ? { exists: true, data: () => ({ seq: 2 }) }
          : { docs: [], empty: true }
      ),
      update: vi.fn(),
      create: vi.fn(),
      // The code registry claim stages its ownership document with set().
      set: vi.fn(),
    };
    const db: any = {
      // Identity maintenance state and code-registry records are direct
      // document reads; absent here, which is the ordinary case.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(doc('office-uid', { role: 'office' })),
            })),
          };
        }
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'students') {
          return { ...emptyQuery, doc: vi.fn(() => studentRef), add: vi.fn() };
        }
        if (name === '_counters') return { doc: vi.fn(() => counterRef) };
        if (name === 'student_course_enrollments') {
          return { ...emptyQuery, doc: vi.fn((id: string) => ({ id })) };
        }
        if (name === 'admissions_history') return { add: vi.fn().mockResolvedValue({ id: 'h1' }) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    return { db, tx, studentRef };
  }

  function createTrialReq(body: Record<string, unknown>) {
    return {
      method: 'POST',
      headers: {},
      query: { action: 'create-trial' },
      body: {
        name: 'Trial Student',
        dob: '2014-01-01',
        contact: '0384072314',
        grade: 6,
        classId: 'class-ended',
        ...body,
      },
    } as any;
  }

  it('rejects a joinedAt outside the course term before writing anything', async () => {
    const { db, tx } = buildDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(createTrialReq({ joinedAt: '2026-04-15' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: 'joinedAt must fall between 2026-01-05 and 2026-03-31',
    });
    expect(tx.create).not.toHaveBeenCalled();
  });

  // Without an explicit date the two-sided clamp still has to land inside the
  // term, and the trial clock must stay on the real current time so audit and
  // attendance windows do not silently shift.
  it('clamps to the term end and keeps the live trial clock when no joinedAt is sent', async () => {
    const { db, tx, studentRef } = buildDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(createTrialReq({}), res);

    expect(res.statusCode).toBe(201);
    const created = tx.create.mock.calls.find(([ref]) => ref === studentRef)?.[1] as Record<
      string,
      unknown
    >;
    expect(created).toMatchObject({
      trialStartedAt: '2026-05-26T03:00:00.000Z',
      courseJoins: [{ classId: 'class-ended', termStart: '2026-01-05', joinedAt: '2026-03-31' }],
    });
    const enrollment = [...tx.create.mock.calls, ...tx.update.mock.calls]
      .map(([, data]) => data)
      .find((data) => data && 'termStart' in data && 'joinedAt' in data);
    expect(enrollment).toMatchObject({ joinedAt: '2026-03-31', status: 'trial' });
  });
});
