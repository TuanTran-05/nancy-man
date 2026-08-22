import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUpdate } from './update.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

vi.mock('../../lib/logging/auditLog.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getClientIp: vi.fn(() => '127.0.0.1'),
    writeAuditLog: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/services/accountingStudentSummaryService.js', () => ({
  refreshAccountingStudentSummariesAfterCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/services/classService.js', () => ({
  assertTeacherClassAccess: vi.fn(async () => ({
    teacherId: 'teacher-1',
    startDate: '2026-01-05',
    endDate: '2026-12-31',
  })),
}));

const STORED = {
  name: 'Quách Hoàng Minh',
  dob: '2014-05-02',
  contact: '0900000000',
  classId: 'class-1',
  teacherId: 'teacher-1',
  studentId: 'HS260010',
  enrollmentStatus: 'active',
};

/**
 * A student update must not be able to move a child between classes. Class
 * membership lives in `student_course_enrollments` and is changed by the
 * progression service, which closes the source enrollment, opens the target,
 * rolls the ledger, and writes one idempotent event. A profile-field write that
 * merely repointed `classId` would leave all of that behind — which is how a
 * profile ends up claiming a class it has no enrollment in.
 */
function makeHarness(stored: Record<string, unknown> = STORED) {
  const writes: Array<{ path: string; data: unknown }> = [];
  const registry: Record<string, Record<string, unknown>> = {
    HS260010: {
      normalizedCode: 'HS260010',
      canonicalProfileId: 'student-1',
      isPrimary: true,
      status: 'active',
      createdAt: 't',
      updatedAt: 't',
      createdBy: 'office-1',
      updatedBy: 'office-1',
    },
  };

  const query: Record<string, unknown> = {};
  Object.assign(query, {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => ({ empty: true, docs: [] }),
  });

  const tx = {
    async get(target: { path?: string; get?: () => unknown }) {
      const path = target.path;
      if (!path) return { empty: true, docs: [] };
      if (path === '_maintenance/student_identity') return { exists: false, data: () => undefined };
      if (path.startsWith('student_code_registry/')) {
        const record = registry[path.split('/')[1]];
        return { exists: record !== undefined, data: () => record };
      }
      if (path === 'students/student-1') return { exists: true, data: () => stored };
      return { exists: false, data: () => undefined };
    },
    create: vi.fn((ref: { path: string }, data: unknown) => writes.push({ path: ref.path, data })),
    set: vi.fn((ref: { path: string }, data: unknown) => writes.push({ path: ref.path, data })),
    update: vi.fn((ref: { path: string }, data: unknown) => writes.push({ path: ref.path, data })),
  };

  const db = {
    doc: (path: string) => ({ path, get: async () => ({ exists: false, data: () => undefined }) }),
    collection: (name: string) => ({
      ...query,
      doc: (id?: string) => ({ path: `${name}/${id ?? 'auto'}`, id: id ?? 'auto' }),
    }),
    runTransaction: vi.fn(async (callback: (t: unknown) => unknown) => callback(tx)),
  };

  return { db: db as never, tx, writes, registry };
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const USER = { uid: 'office-1' };
const USER_INFO = { role: 'office', name: 'Office' };

function request(body: Record<string, unknown>) {
  return { method: 'PUT', headers: {}, body: { id: 'student-1', ...body } } as never;
}

const UNCHANGED = {
  name: STORED.name,
  dob: STORED.dob,
  contact: STORED.contact,
  classId: STORED.classId,
};

describe('generic update may not change the class relationship', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a different classId before writing anything', async () => {
    const harness = makeHarness();
    const res = makeRes();

    await handleUpdate(request({ ...UNCHANGED, classId: 'class-2' }), res as never, harness.db, USER, USER_INFO);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: expect.stringContaining('STUDENT_CLASS_CHANGE_REQUIRES_PROGRESSION'),
    });
    expect(harness.writes).toEqual([]);
  });

  it.each(['teacherId', 'currentEnrollmentId', 'enrollmentStatus'])(
    'rejects a request carrying %s',
    async (field) => {
      // These are service-managed projections of the canonical enrollment. The
      // handler used to drop them silently, which reads as success to a caller
      // that believes it changed something.
      const harness = makeHarness();
      const res = makeRes();

      await handleUpdate(
        request({ ...UNCHANGED, [field]: 'anything' }),
        res as never,
        harness.db,
        USER,
        USER_INFO
      );

      expect(res.statusCode).toBe(409);
      expect(harness.writes).toEqual([]);
    }
  );

  it('accepts an unchanged classId echoed back by the edit form', async () => {
    // The form always sends the current class. Rejecting its presence rather
    // than its change would break every ordinary edit.
    const harness = makeHarness();
    const res = makeRes();

    await handleUpdate(
      request({ ...UNCHANGED, name: 'Quách Hoàng Minh An' }),
      res as never,
      harness.db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(200);
    expect(harness.writes).toContainEqual(
      expect.objectContaining({ path: 'students/student-1' })
    );
  });
});

describe('primary code changes go through the registry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('claims the new code and demotes the old one in the same transaction', async () => {
    const harness = makeHarness();
    const res = makeRes();

    await handleUpdate(
      request({ ...UNCHANGED, studentId: 'HS260099' }),
      res as never,
      harness.db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(200);
    expect(harness.writes).toContainEqual(
      expect.objectContaining({
        path: 'student_code_registry/HS260099',
        data: expect.objectContaining({ canonicalProfileId: 'student-1', isPrimary: true }),
      })
    );
    expect(harness.writes).toContainEqual(
      expect.objectContaining({
        path: 'student_code_registry/HS260010',
        data: expect.objectContaining({ isPrimary: false, status: 'alias' }),
      })
    );
    expect(harness.writes).toContainEqual(
      expect.objectContaining({ path: 'students/student-1' })
    );
  });

  it('retires the old code when the request asks for retirement', async () => {
    const harness = makeHarness();
    const res = makeRes();

    await handleUpdate(
      request({ ...UNCHANGED, studentId: 'HS260099', previousCodePolicy: 'retired' }),
      res as never,
      harness.db,
      USER,
      USER_INFO
    );

    expect(harness.writes).toContainEqual(
      expect.objectContaining({
        path: 'student_code_registry/HS260010',
        data: expect.objectContaining({ status: 'retired' }),
      })
    );
  });

  it('writes nothing when the requested code belongs to another profile', async () => {
    const harness = makeHarness();
    harness.registry.HS260099 = {
      normalizedCode: 'HS260099',
      canonicalProfileId: 'another-profile',
      isPrimary: true,
      status: 'active',
      createdAt: 't',
      updatedAt: 't',
      createdBy: 'office-1',
      updatedBy: 'office-1',
    };
    const res = makeRes();

    await handleUpdate(
      request({ ...UNCHANGED, studentId: 'HS260099' }),
      res as never,
      harness.db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(409);
    expect(harness.writes).toEqual([]);
  });

  it('leaves the registry alone when the code is unchanged', async () => {
    const harness = makeHarness();
    const res = makeRes();

    await handleUpdate(
      request({ ...UNCHANGED, studentId: 'HS260010' }),
      res as never,
      harness.db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(200);
    expect(
      harness.writes.filter((write) => write.path.startsWith('student_code_registry/'))
    ).toEqual([]);
  });
});
