import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/auth/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { verifyLookupToken, validatePasswordStrength } from '../../server/api/auth/handlers/shared.js';
import { getStudentParentAuthContext } from '../../server/api/lib/student/studentParentAuth.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
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

vi.mock('../../server/api/auth/handlers/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/api/auth/handlers/shared.js')>()),
  verifyLookupToken: vi.fn(),
  validatePasswordStrength: vi.fn(() => ({ valid: true })),
}));

vi.mock('../../server/api/lib/student/studentParentAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/api/lib/student/studentParentAuth.js')>()),
  getStudentParentAuthContext: vi.fn(() => null),
}));

// Defensive: the server/api/auth/route.ts router imports sibling handlers
// (e.g. handleVerifyStudentLogin) that pull in these modules at load time.
// Mirror verify-student-login.test.ts so importing the router never fails.
vi.mock('@/server/api/lib/auth/nativeAdminAuth.js', () => ({
  getAuth: vi.fn(() => ({ createCustomToken: vi.fn() })),
}));

vi.mock('../../server/api/lib/auth/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(),
  isTurnstileFailure: vi.fn(() => false),
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
  return res;
}

function phoneUserReq(body: Record<string, unknown>) {
  return {
    method: 'POST',
    headers: {},
    query: { action: 'reset' },
    body,
  } as any;
}

describe('POST /api/v1/auth/reset — phone lookup token gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 4 } as any);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'phone-uid',
      phone_number: '+84384072314',
      legacyProvider: { sign_in_provider: 'phone' },
    } as any);
    // users doc (for getStudentParentAuthContext input) + students doc lookup
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue(
            name === 'students'
              ? { exists: false }
              : { exists: false, data: () => ({}) }
          ),
        })),
      })),
    } as any);
  });

  it('rejects a reset with neither a session owner nor lookup token (403)', async () => {
    const res = mockRes();
    await handler(
      phoneUserReq({ studentDocId: 'stu-1', type: 'student', newPassword: 'StrongPass123!' }),
      res
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/not authorized/i);
    expect(vi.mocked(verifyLookupToken)).not.toHaveBeenCalled();
  });

  it('rejects a phone reset with an invalid lookup token (403)', async () => {
    vi.mocked(verifyLookupToken).mockReturnValue(false);
    const res = mockRes();
    await handler(
      phoneUserReq({
        studentDocId: 'stu-1',
        type: 'student',
        newPassword: 'StrongPass123!',
        lookupToken: 'bad-token',
      }),
      res
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/lookup token/i);
    expect(vi.mocked(verifyLookupToken)).toHaveBeenCalledWith('bad-token', 'stu-1');
  });

  it('passes the token gate with a valid token and continues (404 for missing student)', async () => {
    vi.mocked(verifyLookupToken).mockReturnValue(true);
    const res = mockRes();
    await handler(
      phoneUserReq({
        studentDocId: 'stu-1',
        type: 'student',
        newPassword: 'StrongPass123!',
        lookupToken: 'good-token',
      }),
      res
    );
    // Token gate passed; student doc does not exist, so the handler reaches the 404 stage.
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/student not found/i);
  });
});
