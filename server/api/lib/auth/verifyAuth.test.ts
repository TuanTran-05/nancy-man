import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  loadSession: vi.fn(),
  decodedFromSession: vi.fn((principal: Record<string, unknown>) => ({
    uid: principal.uid,
    email: principal.email,
    role: principal.role,
    studentId: principal.studentId,
    name: principal.displayName,
    auth_time: 1,
    iat: 1,
    exp: 2,
    aud: 'edutrack-vps',
    iss: 'edutrack-vps',
    sub: principal.uid,
  })),
}));

vi.mock('./sessionStore.js', () => session);

import {
  clearVerifiedAuthContextCache,
  verifyAuthContext,
  verifyAuthToken,
} from './verifyAuth.js';

function mockRes() {
  const res: any = { statusCode: 200 };
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

function req() {
  return { headers: { cookie: 'edutrack_session=session-token' }, method: 'GET' } as any;
}

const adminPrincipal = {
  uid: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Admin One',
  role: 'admin' as const,
  forcePasswordChange: false,
  provider: 'password' as const,
};

describe('native session verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.loadSession.mockResolvedValue(adminPrincipal);
  });

  it('returns a decoded token for an active session', async () => {
    const res = mockRes();

    const result = await verifyAuthToken(req(), res, ['admin']);

    expect(result).toMatchObject({ uid: 'admin-1', role: 'admin', aud: 'edutrack-vps' });
    expect(session.loadSession).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when the session is missing or expired', async () => {
    session.loadSession.mockResolvedValue(null);
    const res = mockRes();

    expect(await verifyAuthToken(req(), res)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Missing or expired session' });
  });

  it('returns 403 when the session role is insufficient', async () => {
    const res = mockRes();

    expect(await verifyAuthToken(req(), res, ['teacher'])).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Insufficient permissions' });
  });

  it('fails closed when the session store is unavailable', async () => {
    session.loadSession.mockRejectedValue(new Error('database unavailable'));
    const res = mockRes();

    expect(await verifyAuthToken(req(), res)).toBeNull();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Unable to verify account status. Please try again later.',
    });
  });

  it('builds authorization context directly from the session principal', async () => {
    const res = mockRes();

    const result = await verifyAuthContext(req(), res, ['admin']);

    expect(result?.decoded).toMatchObject({ uid: 'admin-1', role: 'admin' });
    expect(result?.context).toMatchObject({
      uid: 'admin-1',
      role: 'admin',
      name: 'Admin One',
      isBlocked: false,
    });
    expect(session.loadSession).toHaveBeenCalledOnce();
  });

  it('uses the resolved application profile id for teacher data scoping', async () => {
    session.loadSession.mockResolvedValueOnce({
      authUid: 'native-teacher-1',
      uid: 'teacher-profile-1',
      email: 'teacher@example.com',
      displayName: 'Teacher One',
      role: 'teacher',
      teacherId: 'GV260001',
      forcePasswordChange: false,
      provider: 'password',
      googleLinked: false,
    });
    const res = mockRes();

    const result = await verifyAuthContext(req(), res, ['teacher']);

    expect(result?.context).toMatchObject({
      uid: 'teacher-profile-1',
      role: 'teacher',
      teacherId: 'GV260001',
    });
  });

  it('does not cache authorization context between requests', async () => {
    clearVerifiedAuthContextCache();
    await verifyAuthContext(req(), mockRes(), ['admin']);
    await verifyAuthContext(req(), mockRes(), ['admin']);

    expect(session.loadSession).toHaveBeenCalledTimes(2);
  });
});
