import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildProfilePhoneOtpTrackingId,
  handleConfirmProfilePhoneChange,
  handleRequestProfilePhoneOtp,
  handleVerifyProfilePhoneOtp,
} from '../../server/api/auth/handlers/profilePhoneOtp.js';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { hashSecret } from '../../server/api/lib/student/studentPassword.js';
import { getZaloConfig, sendZaloZNSMessage } from '../../server/api/lib/zalo/zaloHelper.js';
import { logZaloNotification } from '../../server/api/zalo/helpers/zaloBaseHelpers.js';
import { touchRealtimeEvent } from '../../server/api/lib/realtime/events.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
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

vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
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

function makeReq(body: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', 'user-agent': 'vitest' },
    body,
  } as any;
}

function mockAuth(role: string = 'teacher', uid: string = 'staff-uid-1') {
  vi.mocked(verifyAuthToken).mockResolvedValue({ uid, email: 'teacher.teacher@nancy.com' } as any);
  return { uid, role };
}

function makeDb(
  options: {
    uid?: string;
    role?: string;
    oldPhone?: string;
    pending?: Record<string, unknown> | null;
    userExists?: boolean;
  } = {}
) {
  const uid = options.uid || 'staff-uid-1';
  const userData = {
    uid,
    email: 'teacher.teacher@nancy.com',
    displayName: 'Teacher One',
    role: options.role || 'teacher',
    phone: options.oldPhone,
  };
  const otpSet = vi.fn().mockResolvedValue(undefined);
  const otpUpdate = vi.fn().mockResolvedValue(undefined);
  const otpDelete = vi.fn().mockResolvedValue(undefined);
  const userUpdate = vi.fn().mockResolvedValue(undefined);
  const auditSet = vi.fn();
  const userGet = vi.fn().mockResolvedValue({
    exists: options.userExists !== false,
    data: () => userData,
  });
  const otpGet = vi.fn().mockResolvedValue(
    options.pending === null
      ? { exists: false }
      : {
          exists: true,
          data: () => ({
            uid,
            newPhone: '84384072314',
            otpHash: hashSecret('123456'),
            attempts: 0,
            maxAttempts: 5,
            verified: false,
            expiresAt: Date.now() + 60_000,
            ...(options.pending || {}),
          }),
        }
  );

  const userRef = { get: userGet, update: userUpdate };
  const otpRef = { get: otpGet, set: otpSet, update: otpUpdate, delete: otpDelete };
  const auditRef = { set: auditSet };

  const tx = {
    get: vi.fn(async (ref: any) => ref.get()),
    update: vi.fn(),
    delete: vi.fn(),
    set: vi.fn(),
  };

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'users') return { doc: vi.fn(() => userRef) };
      if (name === 'audit_logs') return { doc: vi.fn(() => auditRef) };
      if (name === 'profilePhoneOtps') return { doc: vi.fn(() => otpRef) };
      return { doc: vi.fn(() => ({ get: vi.fn() })) };
    }),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };

  vi.mocked(getDb).mockReturnValue(db as any);
  return {
    db,
    tx,
    otpSet,
    otpUpdate,
    otpDelete,
    userUpdate,
    userGet,
    otpGet,
    auditSet,
    userData,
  };
}

describe('profile phone OTP tracking IDs', () => {
  it('keeps the timestamp and uses a short hashed UID suffix', () => {
    const longUid = 'native-user-id-'.repeat(8);

    const trackingId = buildProfilePhoneOtpTrackingId(longUid, 1760000000000);

    expect(trackingId).toMatch(/^profile_phone_1760000000000_[a-f0-9]{12}$/);
    expect(trackingId.length).toBeLessThanOrEqual(48);
    expect(trackingId).not.toContain(longUid);
  });

  it('changes when the timestamp changes for the same UID', () => {
    const uid = 'staff-uid-1';

    expect(buildProfilePhoneOtpTrackingId(uid, 1760000000000)).not.toBe(
      buildProfilePhoneOtpTrackingId(uid, 1760000000001)
    );
  });
});

describe('profile phone OTP request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);
  });

  it.each(['admin', 'teacher', 'accounting', 'office'])(
    'sends an OTP for internal staff role %s',
    async (role) => {
      mockAuth(role);
      const { otpSet } = makeDb({ role });
      const res = mockRes();

      await handleRequestProfilePhoneOtp(makeReq({ phone: '038 407 2314' }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(checkRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        'profile_phone_otp:staff-uid-1',
        5,
        5 * 60 * 1000,
        { failClosed: true }
      );
      expect(otpSet).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: 'staff-uid-1',
          newPhone: '84384072314',
          otpHash: expect.stringMatching(/^hashed:/),
          attempts: 0,
          maxAttempts: 5,
          verified: false,
          createdAt: expect.any(Number),
          expiresAt: expect.any(Number),
        })
      );
      expect(sendZaloZNSMessage).toHaveBeenCalledWith(
        'otp-template',
        { otp: expect.stringMatching(/^\d{6}$/) },
        '84384072314',
        expect.stringMatching(/^profile_phone_\d{13}_[a-f0-9]{12}$/)
      );
      expect(logZaloNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'otp_profile_phone',
          otpPurpose: 'profile_phone_change',
          status: 'sent',
          phone: '84384072314',
          payloadCaptured: true,
          payloadSnapshot: expect.objectContaining({
            schemaVersion: 1,
            templateId: 'otp-template',
            phone: '84384072314',
            templateData: { otp: '[REDACTED]' },
            redactedFields: ['otp'],
          }),
        })
      );
    }
  );

  it('rejects a non-staff role even when authenticated', async () => {
    mockAuth('student');
    makeDb({ role: 'student' });
    const res = mockRes();

    await handleRequestProfilePhoneOtp(makeReq({ phone: '0384072314' }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Not authorized for profile phone changes' });
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('rejects invalid Vietnamese phone formats', async () => {
    mockAuth('teacher');
    makeDb({ role: 'teacher' });
    const res = mockRes();

    await handleRequestProfilePhoneOtp(makeReq({ phone: '123' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid phone number' });
  });

  it('does not enforce phone uniqueness across staff accounts', async () => {
    mockAuth('teacher');
    const { db } = makeDb({ role: 'teacher' });
    const res = mockRes();

    await handleRequestProfilePhoneOtp(makeReq({ phone: '0384072314' }), res);

    expect(res.statusCode).toBe(200);
    expect(db.collection).not.toHaveBeenCalledWith('users_unique_phones');
    expect(sendZaloZNSMessage).toHaveBeenCalled();
  });

  it('returns 429 when the authenticated user is rate limited', async () => {
    mockAuth('teacher');
    makeDb({ role: 'teacher' });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as any);
    const res = mockRes();

    await handleRequestProfilePhoneOtp(makeReq({ phone: '0384072314' }), res);

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: 'Too many OTP requests. Please try again later.',
    });
  });

  it('returns 503 when the Zalo OTP template is not configured', async () => {
    mockAuth('teacher');
    const { otpSet } = makeDb({ role: 'teacher' });
    vi.mocked(getZaloConfig).mockReturnValueOnce({
      appId: 'app-id',
      appSecret: 'app-secret',
      znsOtpTemplateId: '',
    } as any);
    const res = mockRes();

    await handleRequestProfilePhoneOtp(makeReq({ phone: '0384072314' }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: 'ZALO_ZNS_OTP_TEMPLATE_ID is not configured',
    });
    expect(otpSet).not.toHaveBeenCalled();
  });

  it('returns 502 and clears the pending OTP when Zalo delivery fails', async () => {
    mockAuth('teacher');
    const { otpDelete } = makeDb({ role: 'teacher' });
    vi.mocked(sendZaloZNSMessage).mockResolvedValueOnce({
      success: false,
      error: 'provider failure',
      errorCode: -144,
    } as any);
    const res = mockRes();

    await handleRequestProfilePhoneOtp(makeReq({ phone: '0384072314' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      success: false,
      error: 'Unable to send Zalo verification message. Please try again later.',
    });
    expect(otpDelete).toHaveBeenCalled();
    expect(logZaloNotification).toHaveBeenCalledWith(
      expect.objectContaining({ providerErrorCode: -144 })
    );
  });
});

describe('profile phone OTP verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a pending phone OTP as verified when the code is correct', async () => {
    mockAuth('teacher');
    const { otpUpdate } = makeDb({ role: 'teacher' });
    const res = mockRes();

    await handleVerifyProfilePhoneOtp(makeReq({ otp: '123456' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, phone: '84384072314' });
    expect(otpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        verified: true,
        verifiedAt: expect.any(Number),
      })
    );
  });

  it('increments attempts for an incorrect OTP', async () => {
    mockAuth('teacher');
    const { otpUpdate } = makeDb({ role: 'teacher', pending: { attempts: 1 } });
    const res = mockRes();

    await handleVerifyProfilePhoneOtp(makeReq({ otp: '000000' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid OTP' });
    expect(otpUpdate).toHaveBeenCalledWith({ attempts: 2 });
  });

  it('rejects expired pending OTP documents', async () => {
    mockAuth('teacher');
    makeDb({ role: 'teacher', pending: { expiresAt: Date.now() - 1_000 } });
    const res = mockRes();

    await handleVerifyProfilePhoneOtp(makeReq({ otp: '123456' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'OTP expired. Please request a new code.' });
  });

  it('rejects missing pending OTP documents', async () => {
    mockAuth('teacher');
    makeDb({ role: 'teacher', pending: null });
    const res = mockRes();

    await handleVerifyProfilePhoneOtp(makeReq({ otp: '123456' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'No pending phone verification found.',
    });
  });

  it('rejects locked pending OTP documents', async () => {
    mockAuth('teacher');
    makeDb({ role: 'teacher', pending: { attempts: 5, maxAttempts: 5 } });
    const res = mockRes();

    await handleVerifyProfilePhoneOtp(makeReq({ otp: '123456' }), res);

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: 'Too many incorrect OTP attempts. Please request a new code.',
    });
  });
});

describe('profile phone change confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates users.phone only after OTP verification and writes masked audit metadata', async () => {
    mockAuth('teacher');
    const { tx } = makeDb({
      role: 'teacher',
      oldPhone: '84901234567',
      pending: { verified: true, verifiedAt: Date.now() },
    });
    const res = mockRes();

    await handleConfirmProfilePhoneChange(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, phone: '84384072314' });
    expect(tx.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        phone: '84384072314',
        updatedAt: 'serverTimestamp',
      })
    );
    expect(tx.delete).toHaveBeenCalled();
    expect(tx.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'staff-uid-1',
        userRole: 'teacher',
        action: 'update',
        collection: 'users',
        documentId: 'staff-uid-1',
        metadata: {
          method: 'zalo-otp-profile-phone-change',
          oldPhoneMasked: '84***567',
          newPhoneMasked: '84***314',
          role: 'teacher',
        },
        ip: '127.0.0.1',
        userAgent: 'vitest',
        timestamp: expect.any(String),
      })
    );
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
  });

  it('does not invalidate teacher schedules after a non-teacher changes phone', async () => {
    mockAuth('office');
    makeDb({
      role: 'office',
      oldPhone: '84901234567',
      pending: { verified: true, verifiedAt: Date.now() },
    });
    const res = mockRes();

    await handleConfirmProfilePhoneChange(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(touchRealtimeEvent).not.toHaveBeenCalled();
  });

  it('does not return success when the transaction audit write fails', async () => {
    mockAuth('teacher');
    const { tx } = makeDb({
      role: 'teacher',
      oldPhone: '84901234567',
      pending: { verified: true, verifiedAt: Date.now() },
    });
    tx.set.mockImplementationOnce(() => {
      throw new Error('audit write failed');
    });
    const res = mockRes();

    await handleConfirmProfilePhoneChange(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'audit write failed',
    });
  });

  it('rejects confirm before OTP verification', async () => {
    mockAuth('teacher');
    makeDb({ role: 'teacher', pending: { verified: false } });
    const res = mockRes();

    await handleConfirmProfilePhoneChange(makeReq(), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Phone number has not been verified yet.',
    });
  });

  it('rejects confirm when the verified pending document has expired', async () => {
    mockAuth('teacher');
    makeDb({
      role: 'teacher',
      pending: { verified: true, verifiedAt: Date.now() - 10_000, expiresAt: Date.now() - 1_000 },
    });
    const res = mockRes();

    await handleConfirmProfilePhoneChange(makeReq(), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'OTP expired. Please request a new code.' });
  });
});
