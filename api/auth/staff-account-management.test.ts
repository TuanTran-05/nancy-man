import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/server/api/lib/auth/nativeAdminAuth.js';
import handler from '../../server/api/auth/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { getZaloConfig, sendZaloZNSMessage } from '../../server/api/lib/zalo/zaloHelper.js';
import { touchRealtimeEvent } from '../../server/api/lib/realtime/events.js';

vi.mock('@/server/api/lib/auth/nativeAdminAuth.js', () => ({
  getAuth: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/sessionStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/api/lib/auth/sessionStore.js')>()),
  createStaffIdentity: vi.fn(async (input: any) => {
    try {
      const user = await (getAuth() as any).createUser({
        email: input.email,
        password: input.password,
        displayName: input.displayName,
      });
      return {
        uid: user.uid,
        createdAt: user.metadata?.creationTime || new Date().toISOString(),
      };
    } catch (error: any) {
      if (error?.code === 'auth/email-already-exists') throw { ...error, code: '23505' };
      throw error;
    }
  }),
  revokeStaffIdentity: vi.fn(async (uid: string) => {
    const auth = getAuth() as any;
    if (auth?.deleteUser) await auth.deleteUser(uid);
  }),
  rollbackCreatedStaffIdentity: vi.fn(async (uid: string) => {
    const auth = getAuth() as any;
    if (auth?.deleteUser) await auth.deleteUser(uid);
  }),
  revokeStaffIdentitiesByEmail: vi.fn().mockResolvedValue(0),
  findStaffUserIdByEmail: vi.fn().mockResolvedValue(null),
  setStaffPassword: vi.fn().mockResolvedValue(undefined),
  setStaffForcePasswordChange: vi.fn().mockResolvedValue(undefined),
  verifyStaffPassword: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  app: {},
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('../../server/api/lib/zalo/zaloHelper.js', () => ({
  getZaloConfig: vi.fn(() => ({})),
  sendZaloZNSMessage: vi.fn(),
}));

vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/api/lib/logging/auditLog.js')>(
    '../../server/api/lib/logging/auditLog.js'
  );
  return {
    ...actual,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  };
});

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

describe('POST /api/v1/auth/staff-forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue({} as any);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 2 });
  });

  it('rate limits by the first forwarded IP when duplicate headers arrive as an array', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': ['198.51.100.44, 10.0.0.1', '203.0.113.8'] },
        query: { action: 'staff-forgot-password' },
        body: {},
      } as any,
      res
    );

    expect(checkRateLimit).toHaveBeenCalledWith({}, '198.51.100.44', 3, 15 * 60 * 1000);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Missing email' });
  });
});

describe('POST /api/v1/auth/staff-create-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
  });

  it('returns conflict without mutating staff records when the email exists in Auth', async () => {
    const createUser = vi.fn().mockRejectedValue({ code: 'auth/email-already-exists' });
    const getUserByEmail = vi.fn().mockResolvedValue({ uid: 'existing-uid' });
    vi.mocked(getAuth).mockReturnValue({ createUser, getUserByEmail } as any);

    const set = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ set })) })),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-create-account' },
        body: { emailPrefix: 'existing', displayName: 'Existing', role: 'teacher' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'email_already_exists',
      error: 'Email already exists',
    });
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('preserves account creation and temporary password behavior for a new email', async () => {
    const creationTime = '2024-02-29T03:04:05.000Z';
    const createUser = vi.fn().mockResolvedValue({
      uid: 'new-uid',
      metadata: { creationTime },
    });
    vi.mocked(getAuth).mockReturnValue({ createUser, deleteUser: vi.fn() } as any);

    const allowedSet = vi.fn().mockResolvedValue(undefined);
    const userSet = vi.fn().mockResolvedValue(undefined);
    const tempPasswordSet = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'allowed_teachers') {
          return { doc: vi.fn(() => ({ set: allowedSet })) };
        }
        if (name === 'users') {
          return { doc: vi.fn(() => ({ set: userSet })) };
        }
        if (name === '_temp_password_retrievals') {
          return { doc: vi.fn(() => ({ set: tempPasswordSet })) };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-create-account' },
        body: { emailPrefix: 'new', displayName: 'New Teacher', role: 'teacher' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      uid: 'new-uid',
      email: 'new.teacher@nancy.com',
      retrievalToken: expect.any(String),
      authCreated: true,
      zaloSent: false,
      zaloMessageId: '',
    });
    expect(allowedSet).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'teacher', addedByAdmin: true }),
      { merge: true }
    );
    expect(userSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'new-uid',
        email: 'new.teacher@nancy.com',
        role: 'teacher',
        forcePasswordChange: true,
        createdAt: creationTime,
      }),
      { merge: true }
    );
    expect(tempPasswordSet).toHaveBeenCalledWith(
      expect.objectContaining({
        tempPassword: expect.any(String),
        uid: 'new-uid',
        expiresAt: expect.any(String),
      })
    );
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-academic-changed');
  });

  it('records the exact provider error when a staff credential delivery throws', async () => {
    vi.mocked(getZaloConfig).mockReturnValue({
      appId: 'app-id',
      appSecret: 'app-secret',
      znsStaffTemplateId: 'staff-template',
    } as any);
    vi.mocked(sendZaloZNSMessage).mockRejectedValueOnce(new Error('Zalo network unavailable'));
    vi.mocked(getAuth).mockReturnValue({
      createUser: vi.fn().mockResolvedValue({ uid: 'staff-zalo-uid' }),
      deleteUser: vi.fn(),
    } as any);

    const zaloLogAdd = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'zalo_notifications') return { add: zaloLogAdd };
        return { doc: vi.fn(() => ({ set: vi.fn().mockResolvedValue(undefined) })) };
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-create-account' },
        body: {
          emailPrefix: 'zalo.failure',
          displayName: 'Zalo Failure',
          role: 'teacher',
          phone: '0901234567',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      zaloSent: false,
      zaloError: 'Zalo network unavailable',
    });
    expect(zaloLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'staff-credentials',
        status: 'failed',
        errorMessage: 'Zalo network unavailable',
        templateId: 'staff-template',
        payloadCaptured: true,
        payloadSnapshot: expect.objectContaining({
          templateId: 'staff-template',
          phone: '0901234567',
          templateData: {
            name: 'Zalo Failure',
            user_name: 'zalo.failure.teacher@nancy.com',
            pass_word: '[REDACTED]',
          },
          redactedFields: ['pass_word'],
        }),
      })
    );
  });

  it('creates office staff accounts with office suffix while keeping staff creation admin-only', async () => {
    const createUser = vi.fn().mockResolvedValue({ uid: 'office-uid' });
    vi.mocked(getAuth).mockReturnValue({ createUser, deleteUser: vi.fn() } as any);

    const allowedSet = vi.fn().mockResolvedValue(undefined);
    const userSet = vi.fn().mockResolvedValue(undefined);
    const tempPasswordSet = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'allowed_teachers') return { doc: vi.fn(() => ({ set: allowedSet })) };
        if (name === 'users') return { doc: vi.fn(() => ({ set: userSet })) };
        if (name === '_temp_password_retrievals') {
          return { doc: vi.fn(() => ({ set: tempPasswordSet })) };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-create-account' },
        body: { emailPrefix: 'frontdesk', displayName: 'Front Desk', role: 'office' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe('frontdesk.office@nancy.com');
    expect(res.body.retrievalToken).toEqual(expect.any(String));
    expect(allowedSet).toHaveBeenCalledWith(expect.objectContaining({ role: 'office' }), {
      merge: true,
    });
    expect(userSet).toHaveBeenCalledWith(expect.objectContaining({ role: 'office' }), {
      merge: true,
    });
  });

  it('rolls back a newly created Auth user if staff record persistence fails', async () => {
    const createUser = vi.fn().mockResolvedValue({ uid: 'partial-uid' });
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAuth).mockReturnValue({ createUser, deleteUser } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          set: vi.fn().mockRejectedValue(new Error('DocumentStore unavailable')),
        })),
      })),
    } as any);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const res = mockRes();
      await handler(
        {
          method: 'POST',
          headers: {},
          query: { action: 'staff-create-account' },
          body: { emailPrefix: 'partial', displayName: 'Partial Teacher', role: 'teacher' },
        } as any,
        res
      );

      expect(res.statusCode).toBe(500);
      expect(deleteUser).toHaveBeenCalledWith('partial-uid');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('uses the current server instant when Auth creation metadata is missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T06:30:00.000Z'));

    try {
      const createUser = vi.fn().mockResolvedValue({ uid: 'fallback-uid', metadata: {} });
      vi.mocked(getAuth).mockReturnValue({ createUser, deleteUser: vi.fn() } as any);

      const allowedSet = vi.fn().mockResolvedValue(undefined);
      const userSet = vi.fn().mockResolvedValue(undefined);
      const tempPasswordSet = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getDb).mockReturnValue({
        collection: vi.fn((name: string) => {
          if (name === 'allowed_teachers') {
            return { doc: vi.fn(() => ({ set: allowedSet })) };
          }
          if (name === 'users') {
            return { doc: vi.fn(() => ({ set: userSet })) };
          }
          if (name === '_temp_password_retrievals') {
            return { doc: vi.fn(() => ({ set: tempPasswordSet })) };
          }
          return {};
        }),
      } as any);

      const res = mockRes();
      await handler(
        {
          method: 'POST',
          headers: {},
          query: { action: 'staff-create-account' },
          body: { emailPrefix: 'fallback', displayName: 'Fallback Teacher', role: 'teacher' },
        } as any,
        res
      );

      expect(res.statusCode).toBe(200);
      expect(userSet).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: 'fallback-uid',
          createdAt: '2026-07-15T06:30:00.000Z',
        }),
        { merge: true }
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects account creation with a retired staff role', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-create-account' },
        body: {
          emailPrefix: 'legacy',
          displayName: 'Legacy Staff',
          role: ['level', 'manager'].join('_'),
        },
      } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid role' });
  });
});

describe('POST /api/v1/auth/staff-unblock-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
  });

  it('clears the user blocked flag when restoring access', async () => {
    const allowedSet = vi.fn().mockResolvedValue(undefined);
    const blockedDelete = vi.fn().mockResolvedValue(undefined);
    const userUpdate = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'allowed_teachers') {
          return { doc: vi.fn(() => ({ set: allowedSet })) };
        }
        if (name === 'blocked_teachers') {
          return { doc: vi.fn(() => ({ delete: blockedDelete })) };
        }
        if (name === 'users') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [{ ref: { update: userUpdate } }],
                }),
              })),
            })),
          };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-unblock-email' },
        body: { email: 'blocked.teacher@nancy.com' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(allowedSet).toHaveBeenCalled();
    expect(blockedDelete).toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalledWith({ blockedTeacher: false });
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
  });
});

describe('teacher account schedule invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
  });

  it('touches the office schedule after deleting a teacher account', async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAuth).mockReturnValue({ deleteUser } as any);
    const userGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'teacher' }),
    });
    const userDelete = vi.fn().mockResolvedValue(undefined);
    const allowDelete = vi.fn().mockResolvedValue(undefined);
    const blockDelete = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'allowed_teachers') {
          return { doc: vi.fn(() => ({ delete: allowDelete })) };
        }
        if (name === 'blocked_teachers') {
          return { doc: vi.fn(() => ({ delete: blockDelete })) };
        }
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: userGet, delete: userDelete })) };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-delete-account' },
        body: { uid: 'teacher-uid', email: 'teacher.teacher@nancy.com' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(userGet).toHaveBeenCalled();
    expect(userDelete).toHaveBeenCalled();
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-academic-changed');
  });

  it('touches office teacher caches when deleting a blocked teacher email', async () => {
    vi.mocked(getAuth).mockReturnValue({ deleteUser: vi.fn().mockResolvedValue(undefined) } as any);
    const teacherRef = { id: 'teacher-uid' };
    const commit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'allowed_teachers' || name === 'blocked_teachers') {
          return { doc: vi.fn(() => ({ delete: vi.fn().mockResolvedValue(undefined) })) };
        }
        if (name === 'users') {
          return {
            where: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [
                  {
                    id: 'teacher-uid',
                    ref: teacherRef,
                    data: () => ({ role: 'teacher' }),
                  },
                ],
              }),
            })),
          };
        }
        return {};
      }),
      batch: vi.fn(() => ({ delete: vi.fn(), commit })),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-delete-blocked-email' },
        body: { email: 'teacher.teacher@nancy.com' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(commit).toHaveBeenCalled();
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-academic-changed');
  });

  it('touches the office schedule after standardizing teacher IDs', async () => {
    const update = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            docs: [
              {
                ref: { id: 'teacher-uid' },
                data: () => ({ teacherId: 'legacy-id' }),
              },
            ],
          }),
        })),
      })),
      batch: vi.fn(() => ({ update, commit })),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'staff-standardize-teacher-ids' },
        body: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, updated: 1 });
    expect(update).toHaveBeenCalled();
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
  });
});
