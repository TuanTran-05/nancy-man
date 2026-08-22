import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/audit/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { checkRateLimit } from '../../server/api/lib/auth/rateLimit.js';
import { writeAuditLog } from '../../server/api/lib/logging/auditLog.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => {
  const getDb = vi.fn();
  const verifyAuthToken = vi.fn();
  const verifyAuthContext = vi.fn(async (req: any, res: any, requiredRoles: any) => {
    const decoded = await verifyAuthToken(req, res, requiredRoles);
    if (!decoded) return null;
    const db = getDb();
    // In this test, we can query users collection mock from getDb if available
    let role = 'teacher';
    let name = 'Teacher One';
    try {
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        role = data.role || role;
        name = data.displayName || data.name || name;
      }
    } catch {
      // User profile enrichment is optional for these auth test helpers.
    }
    return {
      decoded,
      context: {
        uid: decoded.uid,
        email: decoded.email,
        role: role as any,
        name,
      },
    };
  });
  return { getDb, verifyAuthToken, verifyAuthContext };
});

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/api/lib/logging/auditLog.js')>();
  return {
    ...actual,
    writeAuditLog: vi.fn(),
  };
});

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
  res.send = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.write = vi.fn((chunk: unknown) => {
    res.body = `${res.body || ''}${String(chunk)}`;
    return true;
  });
  res.end = vi.fn(() => res);
  return res;
}

function mockDb(userData: Record<string, unknown> = {}) {
  return {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn(async () => ({
          exists: name === 'users' && id === 'uid-1',
          data: () => userData,
        })),
      })),
    })),
  };
}

describe('POST /api/v1/audit/log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'uid-1',
      email: 'teacher@example.com',
    } as any);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 119 });
    vi.mocked(writeAuditLog).mockResolvedValue(true);
    vi.mocked(getDb).mockReturnValue(
      mockDb({ role: 'teacher', displayName: 'Teacher One' }) as any
    );
  });

  it('writes an audit log with server-side request metadata', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'x-forwarded-for': '203.0.113.10, 10.0.0.1',
          'user-agent': 'vitest',
        },
        query: { action: 'log' },
        body: {
          action: 'create',
          collection: 'users',
          documentId: 'student-1',
          metadata: { source: 'test' },
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'uid-1',
        userRole: 'teacher',
        userName: 'Teacher One',
        action: 'create',
        collection: 'users',
        documentId: 'student-1',
        metadata: { source: 'test' },
        ip: '203.0.113.10',
        userAgent: 'vitest',
      })
    );
  });

  it('authorizes accounting staff to write non-finance client audit logs', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'log' },
        body: {
          action: 'update',
          collection: 'system_crash',
          documentId: 'TypeError',
        },
      } as any,
      res
    );

    expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), res, [
      'admin',
      'teacher',
      'accounting',
    ]);
  });

  it('rejects invalid payloads before writing', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'log' },
        body: { action: 'unknown', collection: 'students', documentId: 'student-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects client-submitted finance audit entries', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'log' },
        body: { action: 'update', collection: 'payment_requests', documentId: 'payment-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('accepts each allowlisted client audit collection', async () => {
    for (const collection of ['system_crash', 'allowed_teachers', 'users', 'blocked_teachers']) {
      vi.mocked(writeAuditLog).mockClear();
      const res = mockRes();
      await handler(
        {
          method: 'POST',
          headers: {},
          query: { action: 'log' },
          body: { action: 'update', collection, documentId: 'doc-1' },
        } as any,
        res
      );
      expect(res.statusCode).toBe(200);
      expect(writeAuditLog).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects a collection outside the client allowlist (400)', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'log' },
        body: { action: 'update', collection: 'students', documentId: 'student-1' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('canonicalizes a whitespace-padded collection before writing', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'log' },
        body: { action: 'update', collection: '  users  ', documentId: 'doc-1' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ collection: 'users' })
    );
  });
});

describe('GET /api/v1/audit/export-*', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
    } as any);
    vi.mocked(writeAuditLog).mockResolvedValue(true);
  });

  function mockExportDb() {
    const jobRef = {
      id: 'job-1',
      set: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const makeQuery = () => {
      const query: any = {
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        startAfter: vi.fn(() => query),
        get: vi.fn(async () => ({ docs: [], size: 0 })),
      };
      return query;
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'jobs') {
          return { doc: vi.fn(() => jobRef) };
        }
        const query = makeQuery();
        return {
          ...query,
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({
              exists: name === 'users',
              data: () => ({ role: 'admin', displayName: 'Admin One' }),
            })),
          })),
        };
      }),
    };
    return Object.assign(db, { jobRef });
  }

  it('reads full export collections through paginated chunks', async () => {
    const page1 = Array.from({ length: 500 }, (_, index) => ({
      id: `user-${index}`,
      data: () => ({ email: `u${index}@example.com` }),
    }));
    const page2 = [{ id: 'user-500', data: () => ({ email: 'u500@example.com' }) }];
    const getCallsByCollection: Record<string, number> = {};
    let cursorDocId: string | null = null;
    const makeQuery = (name: string) => {
      const query: any = {
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        startAfter: vi.fn((cDoc) => {
          cursorDocId = cDoc ? cDoc.id : null;
          return query;
        }),
        get: vi.fn(async () => {
          if (name !== 'users') return { docs: [], size: 0 };
          getCallsByCollection[name] = (getCallsByCollection[name] || 0) + 1;
          if (cursorDocId === 'user-499') {
            return { docs: page2, size: page2.length };
          }
          if (cursorDocId === 'user-500') {
            return { docs: [], size: 0 };
          }
          return { docs: page1, size: page1.length };
        }),
      };
      return query;
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          cursorDocId = null;
        }
        if (name === 'jobs') {
          return {
            doc: vi.fn(() => ({
              id: 'job-1',
              set: vi.fn().mockResolvedValue(undefined),
              update: vi.fn().mockResolvedValue(undefined),
            })),
          };
        }
        const query = makeQuery(name);
        return {
          ...query,
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({
              exists: name === 'users',
              data: () => ({ role: 'admin', displayName: 'Admin One' }),
            })),
          })),
        };
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'export-sql', reason: 'monthly backup' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(getCallsByCollection.users).toBe(4); // 2 calls for pre-scan + 2 calls for streaming
    expect(String(res.body)).toContain('user-500');
  });

  it('audits full SQL exports before returning the file', async () => {
    const db = mockExportDb();
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        headers: {
          'x-forwarded-for': '203.0.113.10',
          'user-agent': 'vitest',
        },
        query: { action: 'export-sql', reason: 'monthly backup' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'admin-uid',
        userRole: 'admin',
        userName: 'Admin One',
        action: 'export',
        collection: 'full_export',
        documentId: 'sql',
        metadata: expect.objectContaining({ reason: 'monthly backup' }),
        ip: '203.0.113.10',
        userAgent: 'vitest',
      })
    );
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    expect(db.jobRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'export',
        name: 'full-export-sql',
        status: 'running',
      })
    );
    expect(db.jobRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        result: expect.objectContaining({ format: 'sql' }),
      })
    );
  });

  it('blocks full exports when the audit entry cannot be written', async () => {
    vi.mocked(getDb).mockReturnValue(mockExportDb() as any);
    vi.mocked(writeAuditLog).mockResolvedValue(false);
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'export-excel', reason: 'incident response' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('requires a reason for full exports', async () => {
    vi.mocked(getDb).mockReturnValue(mockExportDb() as any);
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'export-sql' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
