import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/auth/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { hashStudentPassword } from '../../server/api/lib/student/studentPassword.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
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

function mockDb(studentData: Record<string, unknown>, userData: Record<string, unknown>) {
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
  return {
    collection: (name: string) => ({
      doc: (_id: string) => ({
        get: vi
          .fn()
          .mockResolvedValue(
            name === 'student_auth_credentials'
              ? { exists: Object.keys(credData).length > 0, data: () => credData }
              : name === 'students'
                ? { exists: true, data: () => studentData }
                : { exists: true, data: () => userData }
          ),
      }),
    }),
  } as any;
}

describe('POST /api/v1/auth/verify-current-password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifies a student PBKDF2 password for the owner', async () => {
    const hashed = hashStudentPassword('CurrentPass1');
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'student:doc-1',
      role: 'student',
      studentId: 'doc-1',
    } as any);
    vi.mocked(getDb).mockReturnValue(
      mockDb(
        {
          customLoginPasswordSet: true,
          loginPasswordSalt: hashed.salt,
          loginPasswordHash: hashed.hash,
          passwordVersion: 2,
        },
        { uid: 'student:doc-1', studentId: 'doc-1', role: 'student' }
      )
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-current-password' },
        body: { studentDocId: 'doc-1', type: 'student', currentPassword: 'CurrentPass1' },
      } as any,
      res
    );

    console.log(res.body); expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, valid: true });
  });

  it('rejects access to another student record', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'student:doc-2',
      role: 'student',
      studentId: 'doc-2',
    } as any);
    vi.mocked(getDb).mockReturnValue(
      mockDb({ dob: '2010-01-01' }, { uid: 'student:doc-2', studentId: 'doc-2', role: 'student' })
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-current-password' },
        body: { studentDocId: 'doc-1', type: 'student', currentPassword: '01/01/2010' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });

  it('rejects staff password probing', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'teacher-1' } as any);
    vi.mocked(getDb).mockReturnValue(
      mockDb({ dob: '2010-01-01' }, { uid: 'teacher-1', role: 'teacher' })
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-current-password' },
        body: { studentDocId: 'doc-1', type: 'student', currentPassword: '01/01/2010' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });

  it('rejects parent attempts to verify the student password by changing type', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'parent:doc-1',
      role: 'parent',
      studentId: 'doc-1',
    } as any);
    vi.mocked(getDb).mockReturnValue(
      mockDb({ dob: '2010-01-01' }, { uid: 'parent:doc-1', studentId: 'doc-1', role: 'parent' })
    );

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'verify-current-password' },
        body: { studentDocId: 'doc-1', type: 'student', currentPassword: '01/01/2010' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });
});
