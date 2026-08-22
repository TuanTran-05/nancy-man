import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/auth/route';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { writeAuditLog } from '../../server/api/lib/logging/auditLog.js';
import { hashStudentPassword } from '../../server/api/lib/student/studentPassword.js';
import { verifyTurnstileToken } from '../../server/api/lib/auth/turnstile.js';

const ensureStudentSessionUser = vi.hoisted(() => vi.fn());
const createSession = vi.hoisted(() => vi.fn());

vi.mock('../../server/api/lib/auth/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(),
  isTurnstileFailure: vi.fn((res: any) => !res.success),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  app: {},
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/auth/sessionStore.js', () => ({
  ensureStudentSessionUser,
  createSession,
  publicSessionUser: vi.fn((principal: any) => ({
    uid: principal.uid,
    role: principal.role,
    studentId: principal.studentId,
  })),
}));

function mockRes() {
  const res: any = {};
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

function mockLoginDb({
  studentDocId = 'doc-1',
  studentData,
  transactionStudentData = studentData,
  credentialData,
  existingUserData,
  userSet = vi.fn().mockResolvedValue(undefined),
}: {
  studentDocId?: string;
  studentData: Record<string, unknown>;
  transactionStudentData?: Record<string, unknown>;
  credentialData?: Record<string, unknown> | null;
  existingUserData?: Record<string, unknown> | null;
  userSet?: ReturnType<typeof vi.fn>;
}) {
  const userGet = vi
    .fn()
    .mockResolvedValue(
      existingUserData
        ? { exists: true, data: () => existingUserData }
        : { exists: false, data: () => undefined }
    );

  // Extract credential fields for the student_auth_credentials collection mock
  const credData: Record<string, unknown> = {};
  for (const key of [
    'loginPasswordSalt',
    'loginPasswordHash',
    'passwordVersion',
    'parentPasswordSalt',
    'parentPasswordHash',
    'parentPasswordVersion',
  ]) {
    if (key in studentData) credData[key] = studentData[key];
  }
  const storedCredentialData = credentialData === undefined ? credData : credentialData || {};
  const credGet = vi.fn().mockResolvedValue({
    exists: credentialData !== null && Object.keys(storedCredentialData).length > 0,
    data: () => storedCredentialData,
  });
  const credentialSet = vi.fn().mockResolvedValue(undefined);
  const studentUpdate = vi.fn().mockResolvedValue(undefined);
  const transactionEvents: string[] = [];
  const maintenanceData = {
    mode: 'normal',
    activeRunId: null,
    migrationActorId: null,
    updatedAt: '2026-08-09T09:00:00.000Z',
    updatedBy: 'operator',
  };
  const maintenanceRef = {
    path: '_maintenance/student_identity',
    get: vi.fn(async () => ({ exists: true, data: () => maintenanceData })),
  };
  const studentRef = {
    path: `students/${studentDocId}`,
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => transactionStudentData,
    }),
  };
  const credentialRef = {
    path: `student_auth_credentials/${studentDocId}`,
    get: credGet,
    set: credentialSet,
  };
  const userRef = {
    path: 'users/auth-profile',
    get: userGet,
    set: userSet,
  };

  const runTransaction = vi.fn(async (callback: any) =>
    callback({
      get: async (ref: { path: string; get: () => Promise<unknown> }) => {
        transactionEvents.push(`tx.get:${ref.path}`);
        return ref.get();
      },
      set: vi.fn((ref: unknown, data: unknown, options: unknown) => {
        transactionEvents.push(`tx.set:${String((ref as { path?: string })?.path || 'unknown')}`);
        if (ref === credentialRef) return credentialSet(data, options);
        return (userSet as (data: unknown, options: unknown) => unknown)(data, options);
      }),
      update: vi.fn((ref: unknown, data: unknown) => {
        transactionEvents.push(`tx.update:${String((ref as { path?: string })?.path || 'unknown')}`);
        if (ref === studentRef) return studentUpdate(data);
      }),
    })
  );

  return {
    userSet,
    credentialSet,
    studentUpdate,
    transactionEvents,
    runTransaction,
    db: {
      doc: vi.fn((path: string) => (path === maintenanceRef.path ? maintenanceRef : { path })),
      runTransaction,
      collection: (name: string) => {
        if (name === 'students') {
          return {
            where: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [
                  {
                    id: studentDocId,
                    data: () => studentData,
                  },
                ],
              }),
            })),
            doc: vi.fn(() => studentRef),
          };
        }

        if (name === 'student_auth_credentials') {
          return {
            doc: vi.fn(() => credentialRef),
          };
        }

        return {
          doc: vi.fn(() => userRef),
        };
      },
    },
  };
}

describe('POST /api/v1/auth/verify-student-login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);
    vi.mocked(verifyTurnstileToken).mockResolvedValue({ success: true, action: 'login' });
    ensureStudentSessionUser.mockResolvedValue(undefined);
    createSession.mockImplementation(async (_req, _res, uid, provider) => ({
      uid,
      displayName: 'Student',
      role: provider,
      studentId: 'doc-1',
      forcePasswordChange: false,
      provider,
      googleLinked: false,
    }));
  });

  it('creates a student UID/profile before returning the custom token', async () => {
    const hashed = hashStudentPassword('StudentPass1');
    const mocked = mockLoginDb({
      studentData: {
        name: 'Test Student',
        studentId: 'HS001',
        classId: 'class-1',
        teacherId: 'teacher-1',
        faceImage: 'face.jpg',
        customLoginPasswordSet: true,
        loginPasswordSalt: hashed.salt,
        loginPasswordHash: hashed.hash,
        passwordVersion: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'StudentPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(mocked.userSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'student:doc-1',
        displayName: 'Test Student',
        role: 'student',
        studentId: 'doc-1',
        classId: 'class-1',
        teacherId: 'teacher-1',
        faceImage: 'face.jpg',
      }),
      { merge: true }
    );
    expect(ensureStudentSessionUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'student:doc-1',
        role: 'student',
        studentId: 'doc-1',
      })
    );
    expect(createSession).toHaveBeenCalledWith(
      expect.anything(),
      res,
      'student:doc-1',
      'student'
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toMatchObject({ uid: 'student:doc-1', role: 'student' });
  });

  it('does not migrate legacy credentials when the password is invalid', async () => {
    const hashed = hashStudentPassword('CorrectPass1');
    const mocked = mockLoginDb({
      credentialData: null,
      studentData: {
        name: 'Legacy Student',
        studentId: 'HS001',
        customLoginPasswordSet: true,
        loginPasswordSalt: hashed.salt,
        loginPasswordHash: hashed.hash,
        passwordVersion: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'WrongPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(401);
    expect(mocked.runTransaction).not.toHaveBeenCalled();
    expect(mocked.credentialSet).not.toHaveBeenCalled();
    expect(mocked.studentUpdate).not.toHaveBeenCalled();
    expect(mocked.userSet).not.toHaveBeenCalled();
  });

  it('migrates valid legacy credentials after validation with maintenance read first', async () => {
    const hashed = hashStudentPassword('CorrectPass1');
    const mocked = mockLoginDb({
      credentialData: null,
      studentData: {
        name: 'Legacy Student',
        studentId: 'HS001',
        classId: 'class-1',
        customLoginPasswordSet: true,
        loginPasswordSalt: hashed.salt,
        loginPasswordHash: hashed.hash,
        passwordVersion: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'CorrectPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.credentialSet).toHaveBeenCalledOnce();
    expect(mocked.studentUpdate).toHaveBeenCalledOnce();
    expect(mocked.transactionEvents.slice(0, 3)).toEqual([
      'tx.get:_maintenance/student_identity',
      'tx.get:students/doc-1',
      'tx.get:student_auth_credentials/doc-1',
    ]);
  });

  it('does not return private routing or storage fields in the student login response', async () => {
    const hashed = hashStudentPassword('StudentPass1');
    const mocked = mockLoginDb({
      studentData: {
        name: 'Test Student',
        studentId: 'HS001',
        classId: 'class-1',
        teacherId: 'teacher-1',
        faceImage: 'face.jpg',
        faceImageStoragePath: 'faces/doc-1.jpg',
        customLoginPasswordSet: true,
        loginPasswordSalt: hashed.salt,
        loginPasswordHash: hashed.hash,
        passwordVersion: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'StudentPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.student).toMatchObject({
      docId: 'doc-1',
      name: 'Test Student',
      studentId: 'HS001',
      classId: 'class-1',
      forcePasswordChange: false,
    });
    expect(res.body.student).not.toHaveProperty('teacherId');
    expect(res.body.student).not.toHaveProperty('faceImageStoragePath');
  });

  it('materializes the linked profile from the latest canonical student snapshot', async () => {
    const hashed = hashStudentPassword('StudentPass1');
    const mocked = mockLoginDb({
      studentData: {
        name: 'Test Student',
        studentId: 'HS001',
        classId: 'class-old',
        customLoginPasswordSet: true,
        loginPasswordSalt: hashed.salt,
        loginPasswordHash: hashed.hash,
        passwordVersion: 2,
      },
      transactionStudentData: {
        name: 'Test Student',
        studentId: 'HS001',
        classId: 'class-new',
        teacherId: 'teacher-new',
        customLoginPasswordSet: true,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'StudentPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(mocked.userSet).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'class-new',
        teacherId: 'teacher-new',
      }),
      { merge: true }
    );
    expect(res.body.student.classId).toBe('class-new');
  });

  it('refuses a token when the canonical student is revoked before profile materialization', async () => {
    const hashed = hashStudentPassword('StudentPass1');
    const mocked = mockLoginDb({
      studentData: {
        name: 'Test Student',
        studentId: 'HS001',
        enrollmentStatus: 'active',
        customLoginPasswordSet: true,
        loginPasswordSalt: hashed.salt,
        loginPasswordHash: hashed.hash,
        passwordVersion: 2,
      },
      transactionStudentData: {
        name: 'Test Student',
        studentId: 'HS001',
        enrollmentStatus: 'active',
        isRevoked: true,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'StudentPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.blockedReason).toBe('revoked');
    expect(mocked.userSet).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('blocks parent login for dropped records with no reliable dropped date', async () => {
    const hashed = hashStudentPassword('ParentPass1');
    const mocked = mockLoginDb({
      studentData: {
        name: 'Dropped Student',
        studentId: 'HS003',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'enrolled',
        parentPasswordSet: true,
        parentPasswordSalt: hashed.salt,
        parentPasswordHash: hashed.hash,
        parentPasswordVersion: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS003', password: 'ParentPass1', loginType: 'parent' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.blockedReason).toBe('dropped_parent');
    expect(mocked.userSet).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('allows the birthday fallback for students without a custom password', async () => {
    const mocked = mockLoginDb({
      studentData: {
        name: 'Birthday Student',
        studentId: 'HS002',
        dob: '2010-01-02',
        classId: 'class-2',
        teacherId: 'teacher-2',
        enrollmentStatus: 'active',
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS002', password: '02/01/2010', loginType: 'student' },
      } as any,
      res
    );

    expect(mocked.userSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'student:doc-1',
        displayName: 'Birthday Student',
        role: 'student',
        studentId: 'doc-1',
        classId: 'class-2',
        teacherId: 'teacher-2',
      }),
      { merge: true }
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toMatchObject({ uid: 'student:doc-1', role: 'student' });
  });

  it('creates a parent UID/profile without student face image', async () => {
    const hashed = hashStudentPassword('ParentPass1');
    const mocked = mockLoginDb({
      studentData: {
        name: 'Test Student',
        studentId: 'HS001',
        classId: 'class-1',
        teacherId: 'teacher-1',
        faceImage: 'face.jpg',
        parentForcePasswordChange: true,
        parentPasswordSet: true,
        parentPasswordSalt: hashed.salt,
        parentPasswordHash: hashed.hash,
        parentPasswordVersion: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'ParentPass1', loginType: 'parent' },
      } as any,
      res
    );

    expect(mocked.userSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'parent:doc-1',
        role: 'parent',
        studentId: 'doc-1',
        faceImage: null,
        forcePasswordChange: true,
      }),
      { merge: true }
    );
    expect(createSession).toHaveBeenCalledWith(
      expect.anything(),
      res,
      'parent:doc-1',
      'parent'
    );
  });

  it('does not return a token if profile upsert fails', async () => {
    const hashed = hashStudentPassword('StudentPass1');
    const userSet = vi.fn().mockRejectedValue(new Error('profile write failed'));
    const mocked = mockLoginDb({
      userSet,
      studentData: {
        name: 'Test Student',
        studentId: 'HS001',
        customLoginPasswordSet: true,
        loginPasswordSalt: hashed.salt,
        loginPasswordHash: hashed.hash,
        passwordVersion: 2,
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'StudentPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(createSession).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });

  it('rejects invalid Turnstile before rate limiting or credential lookup', async () => {
    vi.mocked(verifyTurnstileToken).mockResolvedValueOnce({
      success: false,
      errorCode: 'missing-token',
      error: 'Turnstile token is required',
    });

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        query: { action: 'verify-student-login' },
        body: { studentCode: 'HS001', password: 'StudentPass1', loginType: 'student' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'turnstile_failed',
      turnstileErrorCode: 'missing-token',
      error: 'Bot verification failed. Please try again.',
    });
    expect(checkRateLimit).toHaveBeenCalled();
    expect(getDb).toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/verify-credential-migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-1',
      email: 'admin@example.com',
    } as any);
  });

  it('returns legacy credential counts and writes audit evidence without credential values', async () => {
    let queryCallCount = 0;
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name !== 'students') return {};
        const q: any = {
          orderBy: vi.fn(() => q),
          limit: vi.fn(() => q),
          startAfter: vi.fn(() => q),
          get: vi.fn(async () => {
            queryCallCount++;
            if (queryCallCount > 1) return { empty: true, docs: [], size: 0 };
            return {
              empty: false,
              size: 2,
              docs: [
                { id: 'student-1', data: () => ({ name: 'A', loginPasswordHash: 'secret-hash' }) },
                { id: 'student-2', data: () => ({ name: 'B' }) },
              ],
            };
          }),
        };
        return { orderBy: vi.fn(() => q) };
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: { 'user-agent': 'vitest' },
        query: { action: 'verify-credential-migration' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      verification: {
        scanned: 2,
        legacyDocuments: 1,
        safeToEnableDirectStudentReads: false,
      },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        collection: 'student_auth_credentials',
        documentId: 'migration-verification',
        metadata: {
          action: 'verify-credential-migration',
          scanned: 2,
          legacyDocuments: 1,
          safeToEnableDirectStudentReads: false,
        },
      })
    );
    expect(JSON.stringify(res.body)).not.toContain('secret-hash');
    expect(JSON.stringify(vi.mocked(writeAuditLog).mock.calls)).not.toContain('secret-hash');
  });
});
