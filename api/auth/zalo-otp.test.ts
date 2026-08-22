import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import {
  handleRequestZaloOtp,
  handleResetPasswordZalo,
  handleVerifyZaloOtp,
} from '../../server/api/auth/handlers/zaloOtp.js';
import { getDb } from '../../server/api/lib/auth/verifyAuth.js';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { setStudentCredentials } from '../../server/api/lib/student/studentCredentials.js';
import { syncStudentLinkedUsersInTransaction } from '../../server/api/lib/student/studentProfileSync.js';
import { hashSecret } from '../../server/api/lib/student/studentPassword.js';
import { sendZaloZNSMessage } from '../../server/api/lib/zalo/zaloHelper.js';
import { getAuth } from '@/server/api/lib/auth/nativeAdminAuth.js';
import { writeCriticalAuditLog } from '../../server/api/lib/logging/auditLog.js';
import { logZaloNotification } from '../../server/api/zalo/helpers/zaloBaseHelpers.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

vi.mock('@/server/api/lib/auth/nativeAdminAuth.js', () => ({
  getAuth: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/sessionStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/api/lib/auth/sessionStore.js')>()),
  setStaffPassword: vi.fn(async (uid: string, password: string) => {
    await (getAuth() as any).updateUser(uid, { password });
  }),
  setStaffForcePasswordChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/api/lib/logging/auditLog.js')>(
    '../../server/api/lib/logging/auditLog.js'
  );
  return {
    ...actual,
    writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('../../server/api/lib/student/studentCredentials.js', () => ({
  setStudentCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/student/studentProfileSync.js', () => ({
  syncStudentLinkedUsersInTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/student/studentPassword.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../server/api/lib/student/studentPassword.js')>();
  return {
    ...actual,
    hashSecret: vi.fn((value: string) => `hashed:${value}`),
    verifySecret: vi.fn((hash: string, value: string) => hash === `hashed:${value}`),
  };
});

vi.mock('../../server/api/lib/zalo/zaloHelper.js', () => ({
  getZaloConfig: vi.fn(() => ({
    appId: 'app-id',
    appSecret: 'app-secret',
    znsOtpTemplateId: 'otp-template',
  })),
  sendZaloZNSMessage: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../server/api/zalo/helpers/zaloBaseHelpers.js', () => ({
  logZaloNotification: vi.fn().mockResolvedValue(undefined),
}));

function mockRes() {
  const res: any = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function makeRequest(body: Record<string, unknown>) {
  return {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      studentCode: 'HS260001',
      loginType: 'student',
      ...body,
    },
  } as any;
}

function makeStudentSnapshot(data: Record<string, unknown>) {
  return {
    empty: false,
    docs: [
      {
        id: 'student-1',
        data: () => data,
      },
    ],
  };
}

function mockStudentsQuery(snapshot: unknown) {
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'students') {
        return {
          where: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(snapshot),
          })),
        };
      }
      return {
        doc: vi.fn(() => ({
          set: vi.fn().mockResolvedValue(undefined),
        })),
      };
    }),
  };
  vi.mocked(getDb).mockReturnValue(db as any);
  return db;
}

function makeStaffRequest(body: Record<string, unknown>) {
  return {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: {
      loginType: 'staff',
      email: 'teacher.teacher@nancy.com',
      phone: '0384072314',
      ...body,
    },
  } as any;
}

function staffEmailHashForTest(email: string): string {
  return crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
}

function makeStaffDb(options: {
  allowedExists?: boolean;
  userExists?: boolean;
  userData?: Record<string, unknown>;
  otpSet?: ReturnType<typeof vi.fn>;
}) {
  const otpSet = options.otpSet || vi.fn().mockResolvedValue(undefined);
  const allowedGet = vi.fn().mockResolvedValue({ exists: options.allowedExists !== false });
  const userDocs =
    options.userExists === false
      ? []
      : [
          {
            id: 'staff-uid-1',
            data: () => ({
              uid: 'staff-uid-1',
              email: 'teacher.teacher@nancy.com',
              phone: '0384072314',
              role: 'teacher',
              displayName: 'Teacher One',
              blockedTeacher: false,
              ...options.userData,
            }),
          },
        ];

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'allowed_teachers') {
        return { doc: vi.fn(() => ({ get: allowedGet })) };
      }
      if (name === 'users') {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                empty: userDocs.length === 0,
                docs: userDocs,
              }),
            })),
          })),
        };
      }
      if (name === 'passwordResetOtps') {
        return { doc: vi.fn(() => ({ set: otpSet })) };
      }
      return {};
    }),
  };

  vi.mocked(getDb).mockReturnValue(db as any);
  return { db, otpSet };
}

function makeStaffTokenDb(options: {
  otpData?: Record<string, unknown>;
  tokenData?: Record<string, unknown>;
}) {
  const otpDelete = vi.fn().mockResolvedValue(undefined);
  const otpUpdate = vi.fn().mockResolvedValue(undefined);
  const tokenSet = vi.fn().mockResolvedValue(undefined);
  const tokenDelete = vi.fn().mockResolvedValue(undefined);
  const userUpdate = vi.fn().mockResolvedValue(undefined);

  const otpData = {
    otpHash: hashSecret('123456'),
    loginType: 'staff',
    staffUid: 'staff-uid-1',
    staffEmail: 'teacher.teacher@nancy.com',
    attempts: 0,
    maxAttempts: 5,
    expiresAt: Date.now() + 60_000,
    ...options.otpData,
  };

  const tokenData = {
    resetTokenHash: hashSecret('reset-token'),
    loginType: 'staff',
    staffUid: 'staff-uid-1',
    staffEmail: 'teacher.teacher@nancy.com',
    expiresAt: Date.now() + 60_000,
    ...options.tokenData,
  };

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'passwordResetOtps') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => otpData }),
            delete: otpDelete,
            update: otpUpdate,
          })),
        };
      }
      if (name === 'passwordResetTokens') {
        return {
          doc: vi.fn(() => ({
            set: tokenSet,
            get: vi.fn().mockResolvedValue({ exists: true, data: () => tokenData }),
            delete: tokenDelete,
          })),
        };
      }
      if (name === 'users') {
        return { doc: vi.fn(() => ({ update: userUpdate })) };
      }
      return {};
    }),
  };

  vi.mocked(getDb).mockReturnValue(db as any);
  return { db, otpDelete, otpUpdate, tokenSet, tokenDelete, userUpdate };
}

describe('POST request-zalo-otp identity failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);
  });

  it.each([
    ['unknown code', { empty: true, docs: [] }],
    ['phone mismatch', makeStudentSnapshot({ contact: '0900000000', enrollmentStatus: 'active' })],
    [
      'revoked account',
      makeStudentSnapshot({
        contact: '0384072314',
        enrollmentStatus: 'active',
        isRevoked: true,
      }),
    ],
  ])('returns the same public response for %s', async (_case, snapshot) => {
    mockStudentsQuery(snapshot);
    const res = mockRes();

    await handleRequestZaloOtp(makeRequest({ phone: '0384072314' }), res);

    expect({ status: res.statusCode, body: res.body }).toEqual({
      status: 200,
      body: { success: true },
    });
  });

  it('does not expose provider diagnostics when Zalo delivery fails', async () => {
    mockStudentsQuery(makeStudentSnapshot({ contact: '0384072314', enrollmentStatus: 'active' }));
    vi.mocked(sendZaloZNSMessage).mockResolvedValueOnce({
      success: false,
      error: 'access_token=secret-token provider stack trace',
    } as any);
    const res = mockRes();

    await handleRequestZaloOtp(makeRequest({ phone: '0384072314' }), res);

    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
    expect(JSON.stringify(res.body)).not.toContain('provider stack trace');
  });

  it('stores a redacted snapshot for a student password-reset OTP', async () => {
    mockStudentsQuery(
      makeStudentSnapshot({
        name: 'Nguyễn An',
        code: 'HS260001',
        contact: '0384072314',
        enrollmentStatus: 'active',
      })
    );
    const res = mockRes();

    await handleRequestZaloOtp(makeRequest({ phone: '0384072314' }), res);

    expect(res.statusCode).toBe(200);
    expect(logZaloNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'otp_password_reset',
        payloadCaptured: true,
        payloadSnapshot: expect.objectContaining({
          templateId: 'otp-template',
          phone: '84384072314',
          templateData: { otp: '[REDACTED]' },
          redactedFields: ['otp'],
        }),
      })
    );
  });
});

describe('POST request-zalo-otp staff identity failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);
  });

  it.each([
    ['unknown email', { userExists: false }],
    ['phone mismatch', { userData: { phone: '0900000000' } }],
    ['blocked staff', { userData: { blockedTeacher: true } }],
    ['not allowed anymore', { allowedExists: false }],
  ])('returns the same public response for %s', async (_case, dbOptions) => {
    const { otpSet } = makeStaffDb(dbOptions);
    const res = mockRes();

    await handleRequestZaloOtp(makeStaffRequest({}), res);

    expect({ status: res.statusCode, body: res.body }).toEqual({
      status: 200,
      body: { success: true },
    });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(otpSet).not.toHaveBeenCalled();
  });

  it('stores a staff OTP and sends it through the configured Zalo OTP template', async () => {
    const { otpSet } = makeStaffDb({});
    const res = mockRes();

    await handleRequestZaloOtp(makeStaffRequest({ phone: '038 407 2314' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(otpSet).toHaveBeenCalledWith(
      expect.objectContaining({
        otpHash: expect.stringMatching(/^hashed:/),
        loginType: 'staff',
        staffUid: 'staff-uid-1',
        staffEmail: 'teacher.teacher@nancy.com',
        attempts: 0,
        maxAttempts: 5,
        createdAt: expect.any(Number),
        expiresAt: expect.any(Number),
      })
    );
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'otp-template',
      { otp: expect.stringMatching(/^\d{6}$/) },
      '84384072314',
      expect.stringMatching(/^otp_staff_/)
    );
    expect(logZaloNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'otp_password_reset',
        otpPurpose: 'staff_password_reset',
        status: 'sent',
        payloadCaptured: true,
        payloadSnapshot: expect.objectContaining({
          templateId: 'otp-template',
          phone: '84384072314',
          templateData: { otp: '[REDACTED]' },
          redactedFields: ['otp'],
        }),
      })
    );
  });

  it('rate limits staff OTP by the first forwarded IP when duplicate headers arrive as an array', async () => {
    makeStaffDb({});
    const res = mockRes();

    await handleRequestZaloOtp(
      {
        ...makeStaffRequest({ phone: '038 407 2314' }),
        headers: { 'x-forwarded-for': ['198.51.100.77, 10.0.0.1', '203.0.113.9'] },
      } as any,
      res
    );

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      `staff_zalo_otp:198.51.100.77:${staffEmailHashForTest('teacher.teacher@nancy.com')}`,
      5,
      5 * 60 * 1000,
      { failClosed: true }
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

describe('POST verify-zalo-otp staff flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exchanges a valid staff OTP for a one-time reset token', async () => {
    const { otpDelete, tokenSet } = makeStaffTokenDb({});
    const res = mockRes();

    await handleVerifyZaloOtp(makeStaffRequest({ otp: '123456' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      resetToken: expect.any(String),
    });
    expect(otpDelete).toHaveBeenCalled();
    expect(tokenSet).toHaveBeenCalledWith(
      expect.objectContaining({
        resetTokenHash: expect.any(String),
        loginType: 'staff',
        staffUid: 'staff-uid-1',
        staffEmail: 'teacher.teacher@nancy.com',
        createdAt: expect.any(Number),
        expiresAt: expect.any(Number),
      })
    );
  });
});

describe('POST reset-password-zalo staff flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the native account password and clears forcePasswordChange for staff', async () => {
    const updateUser = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAuth).mockReturnValue({ updateUser } as any);
    const { tokenDelete, userUpdate } = makeStaffTokenDb({});
    const res = mockRes();

    await handleResetPasswordZalo(
      makeStaffRequest({ resetToken: 'reset-token', newPassword: 'StrongPass1' }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(updateUser).toHaveBeenCalledWith('staff-uid-1', { password: 'StrongPass1' });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        forcePasswordChange: false,
        updatedAt: 'serverTimestamp',
      })
    );
    expect(tokenDelete).toHaveBeenCalled();
    expect(writeCriticalAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'staff-uid-1',
        userRole: 'staff',
        action: 'password_reset',
        collection: 'users',
        documentId: 'staff-uid-1',
        metadata: {
          method: 'staff-zalo-otp',
          staffEmail: 'teacher.teacher@nancy.com',
        },
        ip: '127.0.0.1',
        userAgent: '',
      })
    );
  });
});

describe('POST reset-password-zalo projection sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the student and linked user projection atomically with a server timestamp', async () => {
    const tokenRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          resetTokenHash: hashSecret('reset-token'),
          studentDocId: 'student-1',
          loginType: 'student',
          expiresAt: Date.now() + 60_000,
        }),
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const studentRef = { id: 'student-1', update: vi.fn() };
    const tx = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ studentId: 'HS260001', classId: 'class-1', forcePasswordChange: true }),
      }),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'passwordResetTokens') return { doc: vi.fn(() => tokenRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: (writer: typeof tx) => Promise<void>) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handleResetPasswordZalo(
      makeRequest({ resetToken: 'reset-token', newPassword: 'StrongPass1' }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(setStudentCredentials).toHaveBeenCalledWith(
      db,
      'student-1',
      expect.objectContaining({ passwordVersion: 2 })
    );
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(syncStudentLinkedUsersInTransaction).toHaveBeenCalledWith(
      tx,
      db,
      'student-1',
      expect.objectContaining({
        forcePasswordChange: false,
        updatedAt: 'serverTimestamp',
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      studentRef,
      expect.objectContaining({
        customLoginPasswordSet: true,
        forcePasswordChange: false,
        updatedAt: 'serverTimestamp',
      })
    );
    expect(studentRef.update).not.toHaveBeenCalled();
  });
});
