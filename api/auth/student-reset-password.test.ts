import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/auth/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { syncStudentLinkedUsersInTransaction } from '../../server/api/lib/student/studentProfileSync.js';
import { createLookupToken } from '../../server/api/auth/handlers/shared.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('../../server/api/lib/student/studentProfileSync.js', () => ({
  syncStudentLinkedUsersInTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
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

function mockDb({
  userData,
  studentData,
  requestData,
}: {
  userData?: Record<string, unknown>;
  studentData?: Record<string, unknown>;
  requestData?: Record<string, unknown>;
}) {
  const studentUpdate = vi.fn().mockResolvedValue(undefined);
  const requestUpdate = vi.fn().mockResolvedValue(undefined);
  const credSet = vi.fn().mockResolvedValue(undefined);
  const studentRef = { update: studentUpdate };
  const tx = {
    get: vi
      .fn()
      .mockResolvedValue(
        studentData
          ? { exists: true, data: () => studentData }
          : { exists: false, data: () => undefined }
      ),
    update: vi.fn((_ref: unknown, data: Record<string, unknown>) => studentUpdate(data)),
  };

  // Extract credential fields for the student_auth_credentials collection mock
  const credData: Record<string, unknown> = {};
  if (studentData) {
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
  }

  const db = {
    collection: (name: string) => ({
      doc: vi.fn((_id: string) => {
        if (name === 'students') {
          return {
            get: vi
              .fn()
              .mockResolvedValue(
                studentData
                  ? { exists: true, data: () => studentData, ref: studentRef }
                  : { exists: false, data: () => undefined, ref: studentRef }
              ),
          };
        }

        if (name === 'student_auth_credentials') {
          return {
            get: vi.fn().mockResolvedValue({
              exists: Object.keys(credData).length > 0,
              data: () => credData,
            }),
            set: credSet,
          };
        }

        if (name === 'passwordResetRequests') {
          return {
            get: vi
              .fn()
              .mockResolvedValue(
                requestData
                  ? { exists: true, data: () => requestData }
                  : { exists: false, data: () => undefined }
              ),
            update: requestUpdate,
          };
        }

        if (name === '_temp_password_retrievals') {
          return {
            set: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            delete: vi.fn().mockResolvedValue(undefined),
          };
        }

        return {
          get: vi
            .fn()
            .mockResolvedValue(
              userData
                ? { exists: true, data: () => userData }
                : { exists: false, data: () => undefined }
            ),
        };
      }),
    }),
    runTransaction: vi.fn(async (callback: (writer: typeof tx) => Promise<void>) => callback(tx)),
  };

  return { db, studentUpdate, requestUpdate, studentRef, tx };
}

const validResetBody = {
  studentDocId: 'student-doc-1',
  type: 'student',
  newPassword: 'NewPass123',
};

describe('POST /api/v1/student/reset-password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows the student owner to reset their password using the profile target', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'student:student-doc-1',
      role: 'student',
      studentId: 'student-doc-1',
      legacyProvider: { sign_in_provider: 'custom' },
    } as any);
    const mocked = mockDb({
      userData: { uid: 'student:student-doc-1', studentId: 'student-doc-1', role: 'student' },
      studentData: {},
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'reset' },
        body: { ...validResetBody, lookupToken: createLookupToken('student-doc-1') },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mocked.studentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        customLoginPasswordSet: true,
      })
    );
    expect(mocked.db.runTransaction).toHaveBeenCalledOnce();
    expect(syncStudentLinkedUsersInTransaction).toHaveBeenCalledWith(
      mocked.tx,
      mocked.db,
      'student-doc-1',
      expect.objectContaining({ forcePasswordChange: false })
    );
  });

  it('allows a verified phone owner when the phone matches the student contact', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'phone-uid',
      phone_number: '0912345678',
      legacyProvider: { sign_in_provider: 'phone' },
    } as any);
    const mocked = mockDb({
      studentData: { contact: '0912345678' },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'reset' },
        body: { ...validResetBody, lookupToken: createLookupToken('student-doc-1') },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.studentUpdate).toHaveBeenCalledOnce();
  });

  it('rejects anonymous users without ownership or phone verification', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'anon-uid',
      legacyProvider: { sign_in_provider: 'anonymous' },
    } as any);
    const mocked = mockDb({
      studentData: { contact: '0912345678' },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, query: { action: 'reset' }, body: validResetBody } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(mocked.studentUpdate).not.toHaveBeenCalled();
  });

  it('rejects parent attempts to reset the student password by changing type', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'parent:student-doc-1',
      role: 'parent',
      studentId: 'student-doc-1',
      legacyProvider: { sign_in_provider: 'custom' },
    } as any);
    const mocked = mockDb({
      userData: { uid: 'parent:student-doc-1', studentId: 'student-doc-1', role: 'parent' },
      studentData: {},
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, query: { action: 'reset' }, body: validResetBody } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(mocked.studentUpdate).not.toHaveBeenCalled();
  });

  it('ignores approve body target fields and uses the DocumentStore request data', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'teacher-1' } as any);
    const mocked = mockDb({
      userData: { uid: 'teacher-1', role: 'teacher' },
      studentData: { teacherId: 'teacher-1' },
      requestData: {
        status: 'pending',
        studentDocId: 'real-student-doc',
        type: 'parent',
        teacherId: 'teacher-1',
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'approve' },
        body: { requestId: 'request-1', studentDocId: 'tampered-doc', type: 'student' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mocked.studentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        parentPasswordSet: true,
      })
    );
    expect(mocked.studentUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        customLoginPasswordSet: true,
      })
    );
    expect(mocked.requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'approved',
        approvedBy: 'teacher-1',
      })
    );
    expect(mocked.db.runTransaction).toHaveBeenCalledOnce();
    expect(syncStudentLinkedUsersInTransaction).toHaveBeenCalledWith(
      mocked.tx,
      mocked.db,
      'real-student-doc',
      expect.objectContaining({ parentForcePasswordChange: true })
    );
  });

  it('rejects teacher approval outside the actual student scope', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'teacher-1' } as any);
    const mocked = mockDb({
      userData: { uid: 'teacher-1', role: 'teacher' },
      studentData: { teacherId: 'teacher-2' },
      requestData: {
        status: 'pending',
        studentDocId: 'student-doc-1',
        type: 'student',
        teacherId: 'teacher-1',
      },
    });
    vi.mocked(getDb).mockReturnValue(mocked.db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'approve' },
        body: { requestId: 'request-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(mocked.studentUpdate).not.toHaveBeenCalled();
  });
});
