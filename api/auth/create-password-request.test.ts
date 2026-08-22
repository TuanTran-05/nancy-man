import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import handler from '../../server/api/auth/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  app: {},
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

// Use a known secret for deterministic token generation
const TEST_SECRET = 'test-challenge-secret-for-unit-tests';
process.env.LOOKUP_CHALLENGE_SECRET = TEST_SECRET;

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

function createValidToken(studentDocId: string): string {
  const ts = Date.now();
  const payload = `${studentDocId}:${ts}`;
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function createExpiredToken(studentDocId: string): string {
  const ts = Date.now() - 10 * 60 * 1000; // 10 minutes ago (expired)
  const payload = `${studentDocId}:${ts}`;
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function createTamperedToken(studentDocId: string): string {
  const ts = Date.now();
  const payload = `${studentDocId}:${ts}`;
  const sig = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function mockDb(studentDocId: string, studentData: Record<string, unknown>) {
  const passwordResetSet = vi.fn().mockResolvedValue(undefined);
  const passwordResetGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });

  return {
    passwordResetSet,
    db: {
      collection: (name: string) => {
        if (name === 'students') {
          return {
            doc: (id: string) => ({
              get: vi.fn().mockResolvedValue({
                id,
                exists: id === studentDocId,
                data: () => (id === studentDocId ? studentData : undefined),
              }),
            }),
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [{ id: studentDocId, data: () => studentData }],
                }),
              })),
            })),
          };
        }
        if (name === 'passwordResetRequests') {
          return {
            where: vi.fn(() => ({
              where: vi.fn(() => ({
                get: passwordResetGet,
              })),
              get: passwordResetGet,
            })),
            doc: vi.fn(() => ({
              set: passwordResetSet,
            })),
          };
        }
        return { doc: vi.fn(() => ({ get: vi.fn() })) };
      },
    },
  };
}

describe('create-password-request challenge token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'user-1' } as any);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);
    process.env.LOOKUP_CHALLENGE_SECRET = TEST_SECRET;
  });

  it('rejects request without lookup token', async () => {
    const { db } = mockDb('doc-1', { name: 'Student A', contact: '0901234567' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-password-request' },
        body: { studentDocId: 'doc-1', type: 'student', method: 'manual_request' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('lookup token');
  });

  it('rejects request with expired lookup token', async () => {
    const { db } = mockDb('doc-1', { name: 'Student A', contact: '0901234567' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const expiredToken = createExpiredToken('doc-1');
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-password-request' },
        body: {
          studentDocId: 'doc-1',
          type: 'student',
          method: 'manual_request',
          lookupToken: expiredToken,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('lookup token');
  });

  it('rejects request with token signed by wrong secret', async () => {
    const { db } = mockDb('doc-1', { name: 'Student A', contact: '0901234567' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const tamperedToken = createTamperedToken('doc-1');
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-password-request' },
        body: {
          studentDocId: 'doc-1',
          type: 'student',
          method: 'manual_request',
          lookupToken: tamperedToken,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('lookup token');
  });

  it('rejects request with token for a different student', async () => {
    const { db } = mockDb('doc-1', { name: 'Student A', contact: '0901234567' });
    vi.mocked(getDb).mockReturnValue(db as any);

    // Token signed for doc-2, but request is for doc-1
    const wrongStudentToken = createValidToken('doc-2');
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-password-request' },
        body: {
          studentDocId: 'doc-1',
          type: 'student',
          method: 'manual_request',
          lookupToken: wrongStudentToken,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('lookup token');
  });

  it('accepts request with valid lookup token', async () => {
    const { db, passwordResetSet } = mockDb('doc-1', { name: 'Student A', contact: '0901234567' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const validToken = createValidToken('doc-1');
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create-password-request' },
        body: {
          studentDocId: 'doc-1',
          type: 'student',
          method: 'manual_request',
          lookupToken: validToken,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(passwordResetSet).toHaveBeenCalled();
  });
});
