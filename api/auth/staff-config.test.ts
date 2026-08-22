import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/auth/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  app: {},
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
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

describe('GET /api/v1/auth/staff-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
  });

  it('returns allowed staff config', async () => {
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        emails: ['teacher@example.com'],
        roles: { 'teacher@example.com': 'teacher' },
        googleSignInAllowedDomains: ['school.edu.vn'],
        googleSignInDomainPolicy: 'school.edu.vn',
      }),
    });
    vi.mocked(getDb).mockReturnValue({ collection: () => ({ doc: () => ({ get }) }) } as any);

    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'staff-config' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.googleSignInAllowedDomains).toEqual(['school.edu.vn']);
    expect(res.body.data.googleSignInDomainPolicy).toBe('school.edu.vn');
  });

  it('returns an empty config when no document exists', async () => {
    const get = vi.fn().mockResolvedValue({ exists: false });
    vi.mocked(getDb).mockReturnValue({ collection: () => ({ doc: () => ({ get }) }) } as any);

    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'staff-config' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      emails: [],
      roles: {},
      googleSignInAllowedDomains: [],
      googleSignInDomainPolicy: '',
    });
  });
});

describe('POST /api/v1/auth/sync-login staff role resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSyncLoginDb(email: string, allowedData: Record<string, unknown>) {
    const userSet = vi.fn().mockResolvedValue(undefined);
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'config') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
            })),
          };
        }
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
              set: userSet,
            })),
          };
        }
        if (name === 'allowed_teachers') {
          return {
            doc: vi.fn((id: string) => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  id === email
                    ? { exists: true, data: () => allowedData }
                    : { exists: false, data: () => ({}) }
                ),
            })),
          };
        }
        if (name === 'blocked_teachers') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
            })),
          };
        }
        return {};
      }),
    };
    return { db, userSet };
  }

  it('normalizes accounting aliases when syncing staff login', async () => {
    const email = 'accountant@example.com';
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'acct-uid', email } as any);
    const { db, userSet } = mockSyncLoginDb(email, { role: 'accountant' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'sync-login' },
        body: { displayName: 'Accountant' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(userSet).toHaveBeenCalledWith(expect.objectContaining({ email, role: 'accounting' }), {
      merge: true,
    });
  });

  it('infers accounting role from generated accounting email suffix', async () => {
    const email = 'nancy.accounting@nancy.com';
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'acct-uid', email } as any);
    const { db, userSet } = mockSyncLoginDb(email, {});
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'sync-login' },
        body: { displayName: 'Accounting' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(userSet).toHaveBeenCalledWith(expect.objectContaining({ email, role: 'accounting' }), {
      merge: true,
    });
  });
});
