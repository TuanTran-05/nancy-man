import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldPath } from '@/server/db/documentStore.js';
import handler from '../../server/api/read/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { clearAllReadCaches } from '../../server/api/lib/cache/readCache.js';
import {
  assertCanReadStudentScopedResource,
  assertClassAccess,
  assertFinanceAccess,
  getClassGrade,
  getUserContext,
  requireRole,
} from '../../server/api/lib/auth/authz.js';
import { buildFinanceReport } from '../../server/api/lib/services/financeReportService.js';
import { aggregateDashboardReadModel } from '../../server/api/lib/services/dashboardAggregateService.js';
import {
  makeDocumentStoreDocSnapshot,
  makeDocumentStoreQuerySnapshot,
} from '../../server/api/lib/documentStore/testDocumentStoreMocks.js';
import { projectedClassDoc } from '../../server/api/read/handlers/utils.js';

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/authz.js', () => ({
  assertActiveUser: vi.fn(),
  assertCanReadStudentScopedResource: vi.fn(),
  assertClassAccess: vi.fn(),
  assertFinanceAccess: vi.fn(),
  getClassGrade: vi.fn(),
  getUserContext: vi.fn(),
  requireRole: vi.fn(),
  withAuthzStatus: (message: string, statusCode: number) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock('../../server/api/lib/services/financeReportService.js', () => ({
  buildFinanceReport: vi.fn().mockResolvedValue({
    success: true,
    totalIncome: 1000,
    totalExpenses: 250,
    balance: 750,
    monthlyBreakdown: [{ month: '2026-05', income: 1000, expenses: 250, balance: 750 }],
    incomeByLevel: [],
    expensesByCategory: [],
    source: 'aggregate',
  }),
}));

vi.mock('../../server/api/lib/services/dashboardAggregateService.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../server/api/lib/services/dashboardAggregateService.js')
    >();
  return {
    ...actual,
    aggregateDashboardReadModel: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(verifyAuthContext).mockImplementation(async (req: any, res: any) => {
    const decoded = await verifyAuthToken(req, res);
    if (!decoded) return null;
    const context = await getUserContext({} as any, decoded);
    return { decoded, context };
  });
  clearAllReadCaches();
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
  res.end = vi.fn(() => res);
  return res;
}

function mockDoc(id: string, data: Record<string, unknown>) {
  return makeDocumentStoreDocSnapshot({ id, path: `test/${id}`, data });
}

function mockExistingDoc(id: string, data: Record<string, unknown>) {
  return makeDocumentStoreDocSnapshot({ id, path: `test/${id}`, data });
}

function mockQuery(docs: Array<ReturnType<typeof mockDoc>> = []) {
  const query: any = {
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn().mockResolvedValue(makeDocumentStoreQuerySnapshot(docs)),
    doc: vi.fn((id?: string) => {
      const found = docs.find((d) => d.id === id);
      const snapshot =
        found ??
        makeDocumentStoreDocSnapshot({ id: id ?? 'mock-doc', path: `test/${id}`, data: {} });
      return { get: vi.fn().mockResolvedValue(snapshot) };
    }),
  };
  return query;
}

describe('read API students channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'admin-uid',
      role: 'admin',
      email: 'admin@test.com',
    } as any);
  });

  it('returns a complete compact index for exactly 3000 authorized students', async () => {
    const docs = Array.from({ length: 3000 }, (_, index) =>
      mockDoc(`stu-${index}`, {
        name: `Student ${index}`,
        studentId: `HS${index}`,
        code: `CODE${index}`,
        classId: `class-${index % 20}`,
        teacherId: `teacher-${index % 10}`,
        dob: '2012-01-01',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
        contact: 'not-in-index',
        faceImage: 'not-in-index',
        loginPasswordHash: 'not-in-index',
      })
    );
    const studentsQuery = mockQuery(docs);
    const realtimeEvent = mockExistingDoc('students', { version: 42 });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'realtime_events') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(realtimeEvent) })) };
        }
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'students', view: 'index' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(studentsQuery.limit).toHaveBeenCalledWith(3001);
    expect(res.body.data.students).toHaveLength(3000);
    expect(res.body.data.meta).toMatchObject({
      total: 3000,
      complete: true,
      maxSupported: 3000,
      version: 42,
    });
    expect(res.body.data.students[0]).not.toHaveProperty('contact');
    expect(res.body.data.students[0]).not.toHaveProperty('faceImage');
    expect(res.body.data.students[0]).not.toHaveProperty('loginPasswordHash');
    expect(Buffer.byteLength(JSON.stringify(res.body), 'utf8')).toBeLessThan(3_500_000);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Cookie');
    const etagCall = res.setHeader.mock.calls.find(([name]: [string]) => name === 'ETag');
    const quote = String.fromCharCode(34);
    expect(etagCall?.[1]).toMatch(
      new RegExp('^' + quote + 'students-42-[a-f0-9]{16}' + quote + '$')
    );

    const cachedRes = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'students', view: 'index' },
        headers: { 'if-none-match': etagCall?.[1] },
      } as any,
      cachedRes
    );

    expect(cachedRes.statusCode).toBe(304);
    expect(cachedRes.end).toHaveBeenCalledOnce();
    expect(cachedRes.json).not.toHaveBeenCalled();
  });

  it('rejects 3001 students instead of silently returning a partial index', async () => {
    const studentsQuery = mockQuery(
      Array.from({ length: 3001 }, (_, index) =>
        mockDoc(`stu-${index}`, { name: `Student ${index}` })
      )
    );
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'realtime_events') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(mockExistingDoc('students', { version: 1 })),
            })),
          };
        }
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'students', view: 'index' } } as any, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'dataset_limit_exceeded',
    });
    expect(res.body.data).toBeUndefined();
  });

  it('defaults to the academic projection without contact, face or internal fields', async () => {
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          mockDoc('stu-1', {
            name: 'Test Student',
            studentId: 'HS260001',
            dob: '2012-01-01',
            contact: '0384072314',
            faceImage: 'face-data',
            classId: 'class-1',
            teacherId: 'teacher-1',
            loginPasswordHash: 'secret-hash',
            loginPasswordSalt: 'secret-salt',
            internalOnly: 'server-only',
          }),
        ],
      }),
      startAfter: vi.fn(() => studentsQuery),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        return { limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'students', limit: '10' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.students[0]).toEqual({
      id: 'stu-1',
      name: 'Test Student',
      studentId: 'HS260001',
      classId: 'class-1',
      teacherId: 'teacher-1',
      dob: '2012-01-01',
    });
  });

  it('accepts an authorized directory view with contact and display image fields', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'office-uid',
      role: 'office',
      email: 'office@test.com',
    } as any);
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          mockDoc('stu-1', {
            name: 'Trial Student',
            studentId: 'HS260009',
            dob: '2014-02-02',
            contact: '0384072314',
            faceImage: 'face-data',
            faceImageStoragePath: 'faces/stu-1.jpg',
            classId: 'class-1',
            teacherId: 'teacher-1',
            studentLifecycle: 'trial',
            internalOnly: 'server-only',
          }),
        ],
      }),
      startAfter: vi.fn(() => studentsQuery),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        return { limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'students', view: 'directory', limit: '10' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(expect.objectContaining({ role: 'office' }), [
      'admin',
      'teacher',
      'office',
    ]);
    expect(res.body.data.students[0]).toEqual({
      id: 'stu-1',
      name: 'Trial Student',
      studentId: 'HS260009',
      classId: 'class-1',
      teacherId: 'teacher-1',
      dob: '2014-02-02',
      contact: '0384072314',
      faceImage: 'face-data',
      faceImageStoragePath: 'faces/stu-1.jpg',
      studentLifecycle: 'trial',
    });
  });

  it('orders directory reads by name with a document-id tiebreak when there is no equality filter', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'office-uid',
      role: 'office',
      email: 'office@test.com',
    } as any);
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
      startAfter: vi.fn(() => studentsQuery),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        return { limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'students', view: 'directory' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(studentsQuery.where).not.toHaveBeenCalled();
    expect(studentsQuery.orderBy).toHaveBeenNthCalledWith(1, 'name');
    expect(studentsQuery.orderBy).toHaveBeenNthCalledWith(2, FieldPath.documentId());
  });

  it('drops the name sort for equality-filtered directory reads to avoid an unindexed compound query', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-uid',
      role: 'teacher',
      email: 'teacher@test.com',
    } as any);
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
      startAfter: vi.fn(() => studentsQuery),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        return { limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'students', view: 'directory' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(studentsQuery.where).toHaveBeenCalledWith('teacherId', '==', 'teacher-uid');
    expect(studentsQuery.orderBy).toHaveBeenCalledTimes(1);
    expect(studentsQuery.orderBy).toHaveBeenCalledWith(FieldPath.documentId());
  });

  it('allows staff student directory reads to request a large page', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'office-uid',
      role: 'office',
      email: 'office@test.com',
    } as any);
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
      startAfter: vi.fn(() => studentsQuery),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        return { limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'students', view: 'directory', limit: '2000' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(studentsQuery.limit).toHaveBeenCalledWith(2001);
  });

  it('uses an identity projection and validates sensitive finance access', async () => {
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          mockDoc('stu-1', {
            name: 'Minimal Student',
            studentId: 'HS260010',
            classId: 'class-1',
            contact: '0384072314',
            internalOnly: 'server-only',
          }),
        ],
      }),
      startAfter: vi.fn(() => studentsQuery),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => studentsQuery),
    } as any);

    const identityRes = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'students', view: 'identity', limit: '10' } } as any,
      identityRes
    );
    expect(identityRes.body.data.students[0]).toEqual({
      id: 'stu-1',
      name: 'Minimal Student',
      studentId: 'HS260010',
      classId: 'class-1',
    });

    const financeRes = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'students', view: 'finance', limit: '10' } } as any,
      financeRes
    );
    expect(assertFinanceAccess).toHaveBeenCalled();
    expect(financeRes.body.data.students[0]).toEqual({
      id: 'stu-1',
      name: 'Minimal Student',
      studentId: 'HS260010',
      classId: 'class-1',
      contact: '0384072314',
    });
  });

  it('treats an unknown view as academic rather than returning raw data', async () => {
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({
        docs: [
          mockDoc('stu-1', {
            name: 'Student',
            dob: '2012-01-01',
            contact: '0384072314',
            internalOnly: 'server-only',
          }),
        ],
      }),
      startAfter: vi.fn(() => studentsQuery),
    };
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn(() => studentsQuery) } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'students', view: 'raw', limit: '10' } } as any,
      res
    );

    expect(res.body.data.students[0]).toEqual({
      id: 'stu-1',
      name: 'Student',
      dob: '2012-01-01',
    });
  });

  it('treats the retired channel as unknown', async () => {
    const res = mockRes();
    const createReadReq = (channel: string) => ({
      method: 'GET',
      query: { channel, limit: '10' },
    });
    await handler(createReadReq(['level', 'management'].join('-')) as any, res as any);
    expect(res.statusCode).toBe(404);
  });

  it('blocks accounting from the default academic students projection', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    const accountingCtx = {
      uid: 'accounting-uid',
      role: 'accounting',
      email: 'accounting@test.com',
    };
    vi.mocked(getUserContext).mockResolvedValue(accountingCtx as any);
    vi.mocked(requireRole).mockImplementation((ctx: any, roles: string[]) => {
      if (!roles.includes(ctx.role)) {
        throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
      }
      return undefined as any;
    });

    const collection = vi.fn(() =>
      mockQuery([
        mockDoc('stu-1', {
          name: 'Private Student',
          dob: '2012-01-01',
          classId: 'class-1',
          admissionStatus: 'enrolled',
        }),
      ])
    );
    vi.mocked(getDb).mockReturnValue({ collection } as any);

    const res = mockRes();
    try {
      await handler({ method: 'GET', query: { channel: 'students', limit: '10' } } as any, res);
    } finally {
      vi.mocked(requireRole).mockImplementation(() => undefined as any);
    }

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'forbidden',
      error: 'Insufficient permissions',
    });
    expect(collection).not.toHaveBeenCalledWith('students');
  });

  it('allows accounting to read only the finance student projection', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
      email: 'accounting@test.com',
    } as any);

    const studentsQuery = mockQuery([
      mockDoc('stu-1', {
        name: 'Finance Student',
        studentId: 'HS260001',
        classId: 'class-1',
        contact: '0384072314',
        dob: '2012-01-01',
        admissionStatus: 'enrolled',
        loginPasswordHash: 'secret-hash',
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'students', view: 'finance', limit: '10' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assertFinanceAccess).toHaveBeenCalled();
    expect(res.body.data.students[0]).toEqual({
      id: 'stu-1',
      name: 'Finance Student',
      studentId: 'HS260001',
      dob: '2012-01-01',
      classId: 'class-1',
      contact: '0384072314',
    });
  });
});

describe('read API finance resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
      email: 'accounting@test.com',
    } as any);
  });

  it.each([
    ['ledgers', 'course_fee_ledgers'],
    ['receipts', 'receipts'],
    ['expenses', 'expenses'],
    ['invoices', 'invoices'],
  ])('returns cursor pagination for finance %s', async (resource, collectionName) => {
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({
        docs: [mockDoc(`${resource}-1`, { createdAt: '2026-05-26T00:00:00.000Z' })],
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === collectionName) return query;
        return query;
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'finance', resource, limit: '50', status: 'posted' },
      } as any,
      res
    );

    expect(assertFinanceAccess).toHaveBeenCalled();
    expect(query.limit).toHaveBeenCalledWith(51);
    expect(res.body.data).toMatchObject({
      items: expect.any(Array),
      page: {
        resource,
        limit: 50,
        nextCursor: null,
        hasMore: false,
      },
    });
  });

  it('caps requested finance resource limits at 2000 documents', async () => {
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({
        docs: [mockDoc('receipt-1', { createdAt: '2026-05-26T00:00:00.000Z' })],
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => query),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'finance', resource: 'receipts', limit: '500' },
      } as any,
      res
    );

    expect(query.limit).toHaveBeenCalledWith(501);
    expect(res.body.data.page.limit).toBe(500);
  });

  it('defaults finance resource reads to 2000 documents', async () => {
    const query: any = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({
        docs: [mockDoc('ledger-1', { createdAt: '2026-05-26T00:00:00.000Z' })],
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => query),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'finance', resource: 'ledgers' },
      } as any,
      res
    );

    expect(query.limit).toHaveBeenCalledWith(2001);
    expect(res.body.data.page.limit).toBe(2000);
  });

  it('returns cursor pagination for the finance dashboard overview', async () => {
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({
        docs: [mockDoc('stu-1', { name: 'Student', classId: 'class-1' })],
      }),
      startAfter: vi.fn(() => studentsQuery),
    };
    const otherQuery = mockQuery([]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        return otherQuery;
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'finance', limit: '50' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(studentsQuery.limit).toHaveBeenCalledWith(51);
    expect(res.body.data.page).toMatchObject({
      limit: 50,
      nextCursor: null,
      hasMore: false,
    });
  });
});

describe('read API classes visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'teacher-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-uid',
      role: 'teacher',
      email: 'teacher@test.com',
    } as any);
  });

  it('hides archived classes but keeps ended active classes for non-admin class reads', async () => {
    const teacherClassesQuery = mockQuery([
      mockDoc('current-class', {
        name: 'Current Class',
        teacherId: 'teacher-uid',
        status: 'active',
        endDate: '2999-12-31',
      }),
      mockDoc('ended-class', {
        name: 'Ended Class',
        teacherId: 'teacher-uid',
        status: 'active',
        endDate: '2000-01-01',
      }),
      mockDoc('archived-class', {
        name: 'Archived Class',
        teacherId: 'teacher-uid',
        status: 'archived',
        endDate: '2999-12-31',
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') {
          return {
            where: vi.fn(() => teacherClassesQuery),
          };
        }
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'classes' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.classes.map((classRow: { id: string }) => classRow.id)).toEqual([
      'current-class',
      'ended-class',
    ]);
  });
});

describe('read API office academic channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'office-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'office-uid',
      role: 'office',
      email: 'office@test.com',
    } as any);
  });

  it('returns class evaluation completeness and notification counts for office staff', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: 'Class A',
        teacherId: 'teacher-1',
        status: 'active',
        tuitionFee: 1000000,
        currentCourseId: 'course-1',
      }),
      mockDoc('class-2', {
        name: 'Class B',
        teacherId: 'teacher-2',
        status: 'active',
        currentCourseId: 'course-2',
      }),
    ]);
    const studentsQuery = mockQuery([
      mockDoc('student-active', {
        name: 'Active Student',
        studentId: 'HS001',
        classId: 'class-1',
        contact: '0384072314',
        enrollmentStatus: 'active',
      }),
      mockDoc('student-leave', {
        name: 'Leave Student',
        studentId: 'HS002',
        classId: 'class-1',
        contact: '0384072315',
        enrollmentStatus: 'on_leave',
      }),
      mockDoc('student-dropped', {
        name: 'Dropped Student',
        studentId: 'HS003',
        classId: 'class-1',
        enrollmentStatus: 'dropped',
      }),
      mockDoc('student-promoted', {
        name: 'Promoted Student',
        studentId: 'HS004',
        classId: 'class-1',
        enrollmentStatus: 'promoted',
      }),
      mockDoc('student-archived', {
        name: 'Archived Student',
        studentId: 'HS005',
        classId: 'class-1',
        enrollmentStatus: 'active',
        studentLifecycle: 'archived',
      }),
      mockDoc('student-missing', {
        name: 'Missing Eval',
        studentId: 'HS006',
        classId: 'class-2',
        enrollmentStatus: 'active',
      }),
    ]);
    const evaluationsQuery = mockQuery([
      mockDoc('eval-final-1', {
        studentId: 'student-active',
        classId: 'class-1',
        evaluationType: 'final',
        totalScore: 9,
        rank: 'first',
        courseId: 'course-1',
        date: '2026-05-01',
      }),
      mockDoc('eval-legacy', {
        studentId: 'student-leave',
        classId: 'class-1',
        totalScore: 8,
        date: '2026-05-02',
      }),
      mockDoc('eval-midterm-only', {
        studentId: 'student-missing',
        classId: 'class-2',
        evaluationType: 'midterm',
        totalScore: 7,
        date: '2026-05-03',
      }),
    ]);
    const ledgersQuery = mockQuery([
      mockDoc('ledger-1', { studentId: 'student-active', classId: 'class-1', amount: 1000000 }),
    ]);
    const notificationsQuery = mockQuery([
      mockDoc('zalo-eval-1', {
        studentId: 'student-active',
        classId: 'class-1',
        courseId: 'course-1',
        type: 'evaluation_notice',
        status: 'sent',
        evaluationId: 'eval-final-1',
        evaluationVersion: '2026-01-01T00:00:00.000Z',
      }),
      mockDoc('zalo-tuition-1', {
        studentId: 'student-leave',
        classId: 'class-1',
        courseId: 'course-1',
        type: 'tuition_notice',
        status: 'sent',
      }),
      mockDoc('zalo-rank-1', {
        studentId: 'student-active',
        classId: 'class-1',
        courseId: 'course-1',
        type: 'rank_achievement',
        status: 'sent',
        evaluationId: 'eval-final-1',
        evaluationVersion: '2026-01-01T00:00:00.000Z',
      }),
      mockDoc('zalo-failed-1', {
        studentId: 'student-active',
        classId: 'class-1',
        courseId: 'course-1',
        type: 'evaluation_notice',
        status: 'failed',
      }),
    ]);
    const usersQuery = mockQuery();
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'zalo_notifications') return notificationsQuery;
        if (name === 'users') return usersQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(expect.objectContaining({ role: 'office' }), [
      'admin',
      'office',
    ]);
    expect(usersQuery.where).toHaveBeenCalledWith('role', '==', 'teacher');
    expect(res.body.data.summaries['class-1']).toMatchObject({
      classId: 'class-1',
      eligibleStudentCount: 1,
      finalEvaluationCount: 1,
      isEvaluationComplete: true,
      evaluationSentCount: 1,
      tuitionNoticeSentCount: 0,
      missingEvaluationStudentIds: [],
      failedNotificationCount: 1,
    });
    expect(res.body.data.summaries['class-1'].evaluationSentStudentIds).toEqual(['student-active']);
    expect(res.body.data.summaries['class-1'].tuitionNoticeSentStudentIds).toEqual([
      'student-leave',
    ]);
    expect(res.body.data.summaries['class-1'].rankSentStudentIds).toEqual(['student-active']);
    expect(res.body.data.summaries['class-1'].courseClosing).toMatchObject({
      courseId: 'course-1',
      requiredStudentCount: 1,
      finalEvaluationCount: 1,
      evaluationSentCount: 1,
      rankRequiredCount: 1,
      rankSentCount: 1,
      tuitionSentCount: 0,
      pendingEvaluationStudentIds: [],
      pendingRankStudentIds: [],
      pendingTuitionStudentIds: ['student-active'],
      lockedEvaluationIds: ['eval-final-1'],
    });
    expect(res.body.data.summaries['class-2']).toMatchObject({
      eligibleStudentCount: 1,
      finalEvaluationCount: 0,
      isEvaluationComplete: false,
      missingEvaluationStudentIds: ['student-missing'],
    });
    expect(res.body.data.students[0]).not.toHaveProperty('loginPasswordHash');
  });

  it('uses course-scoped versioned evidence and valid exemptions in canonical summaries', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-stale', {
        name: 'Stale evidence',
        status: 'active',
        currentCourseId: 'course-new',
      }),
      mockDoc('class-exempt', {
        name: 'Exempt student',
        status: 'active',
        currentCourseId: 'course-exempt',
        courseClosing: {
          courseId: 'course-exempt',
          termStart: '',
          termEnd: '',
          exemptions: [
            {
              studentId: 'student-exempt',
              reason: 'Approved alternative handling',
              createdBy: 'admin-1',
              createdAt: '2026-07-18T10:00:00.000Z',
            },
          ],
        },
      }),
    ]);
    const studentsQuery = mockQuery([
      mockDoc('student-stale', {
        classId: 'class-stale',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      }),
      mockDoc('student-exempt', {
        classId: 'class-exempt',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      }),
    ]);
    const evaluationsQuery = mockQuery([
      mockDoc('eval-stale', {
        classId: 'class-stale',
        studentId: 'student-stale',
        courseId: 'course-new',
        evaluationType: 'final',
        rank: 'first',
      }),
      mockDoc('eval-exempt', {
        classId: 'class-exempt',
        studentId: 'student-exempt',
        courseId: 'course-exempt',
        evaluationType: 'final',
      }),
    ]);
    const notificationsQuery = mockQuery([
      mockDoc('old-course-evaluation', {
        classId: 'class-stale',
        studentId: 'student-stale',
        courseId: 'course-old',
        type: 'evaluation_notice',
        status: 'sent',
        evaluationId: 'eval-stale',
        evaluationVersion: '2026-01-01T00:00:00.000Z',
      }),
      mockDoc('stale-evaluation-version', {
        classId: 'class-stale',
        studentId: 'student-stale',
        courseId: 'course-new',
        type: 'evaluation_notice',
        status: 'sent',
        evaluationId: 'eval-stale',
        evaluationVersion: '2025-12-31T00:00:00.000Z',
      }),
      mockDoc('stale-rank-version', {
        classId: 'class-stale',
        studentId: 'student-stale',
        courseId: 'course-new',
        type: 'rank_achievement',
        status: 'sent',
        evaluationId: 'eval-stale',
        evaluationVersion: '2025-12-31T00:00:00.000Z',
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return mockQuery();
        if (name === 'zalo_notifications') return notificationsQuery;
        if (name === 'users') return mockQuery();
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.summaries['class-stale'].courseClosing).toMatchObject({
      evaluationSentCount: 0,
      rankRequiredCount: 1,
      rankSentCount: 0,
      pendingEvaluationStudentIds: ['student-stale'],
      pendingRankStudentIds: ['student-stale'],
    });
    expect(res.body.data.summaries['class-exempt'].courseClosing).toMatchObject({
      exemptStudentCount: 1,
      pendingEvaluationStudentIds: [],
      pendingRankStudentIds: [],
      pendingTuitionStudentIds: [],
    });
    expect(res.body.data.notifications).toContainEqual(
      expect.objectContaining({
        id: 'stale-evaluation-version',
        courseId: 'course-new',
        evaluationId: 'eval-stale',
        evaluationVersion: '2025-12-31T00:00:00.000Z',
      })
    );
  });

  it('queries more than ten visible courses in batches without a global notification cap', async () => {
    const classes = Array.from({ length: 11 }, (_, index) =>
      mockDoc(`class-${index}`, {
        name: `Class ${index}`,
        status: 'active',
        currentCourseId: `course-${index}`,
      })
    );
    const classesQuery = mockQuery(classes);
    const studentsQuery = mockQuery([
      mockDoc('student-10', {
        classId: 'class-10',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      }),
    ]);
    const evaluationsQuery = mockQuery([
      mockDoc('eval-10', {
        classId: 'class-10',
        studentId: 'student-10',
        courseId: 'course-10',
        evaluationType: 'final',
      }),
    ]);
    const unrelated = Array.from({ length: 2001 }, (_, index) =>
      mockDoc(`unrelated-${index}`, {
        classId: 'unrelated-class',
        studentId: `unrelated-student-${index}`,
        courseId: 'unrelated-course',
        type: 'evaluation_notice',
        status: 'sent',
      })
    );
    const notificationsQuery = mockQuery([
      ...unrelated,
      mockDoc('relevant-evaluation', {
        classId: 'class-10',
        studentId: 'student-10',
        courseId: 'course-10',
        type: 'evaluation_notice',
        status: 'sent',
        evaluationId: 'eval-10',
        evaluationVersion: '2026-01-01T00:00:00.000Z',
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return mockQuery();
        if (name === 'zalo_notifications') return notificationsQuery;
        if (name === 'users') return mockQuery();
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.data.summaries)).toHaveLength(11);
    expect(res.body.data.summaries['class-10'].courseClosing.evaluationSentCount).toBe(1);
    expect(notificationsQuery.where).toHaveBeenCalledWith(
      'courseId',
      'in',
      expect.arrayContaining(['course-0', 'course-9'])
    );
    expect(notificationsQuery.where).toHaveBeenCalledWith('courseId', 'in', ['course-10']);
    expect(notificationsQuery.orderBy).not.toHaveBeenCalled();
  });

  it('does not require final evaluations from on-leave students in office academic summaries', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: 'Class With Leave',
        teacherId: 'teacher-1',
        status: 'active',
      }),
    ]);
    const studentsQuery = mockQuery([
      mockDoc('student-active', {
        name: 'Active Student',
        studentId: 'HS001',
        classId: 'class-1',
        enrollmentStatus: 'active',
      }),
      mockDoc('student-leave-no-eval', {
        name: 'Leave Student',
        studentId: 'HS002',
        classId: 'class-1',
        enrollmentStatus: 'on_leave',
      }),
    ]);
    const evaluationsQuery = mockQuery([
      mockDoc('eval-active-final', {
        studentId: 'student-active',
        classId: 'class-1',
        evaluationType: 'final',
        totalScore: 9,
        date: '2026-05-01',
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return mockQuery();
        if (name === 'zalo_notifications') return mockQuery();
        if (name === 'users') return mockQuery();
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.students.map((student: { id: string }) => student.id)).toEqual([
      'student-active',
      'student-leave-no-eval',
    ]);
    expect(res.body.data.summaries['class-1']).toMatchObject({
      eligibleStudentCount: 1,
      finalEvaluationCount: 1,
      isEvaluationComplete: true,
      missingEvaluationStudentIds: [],
    });
  });

  it('loads office academic students by class instead of relying on the global student page', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: 'Test Class',
        teacherId: 'teacher-1',
        status: 'active',
      }),
    ]);
    const globalStudentsQuery = mockQuery([
      mockDoc('other-student', {
        name: 'Alpha Student',
        studentId: 'HS000001',
        classId: 'other-class',
        enrollmentStatus: 'active',
      }),
    ]);
    const classStudentsQuery = mockQuery([
      mockDoc('class-student-1', {
        name: 'Test Student One',
        studentId: 'HS260047',
        classId: 'class-1',
        enrollmentStatus: 'active',
      }),
      mockDoc('class-student-2', {
        name: 'Test Student Two',
        studentId: 'HS260048',
        classId: 'class-1',
        enrollmentStatus: 'active',
      }),
    ]);
    const evaluationsQuery = mockQuery([]);
    const ledgersQuery = mockQuery([]);
    const notificationsQuery = mockQuery([]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') {
          const studentsCollection: any = {
            orderBy: vi.fn(() => globalStudentsQuery),
            where: vi.fn((field: string, op: string, value: string[]) => {
              if (field === 'classId' && op === 'in' && value.includes('class-1')) {
                return classStudentsQuery;
              }
              return mockQuery();
            }),
          };
          return studentsCollection;
        }
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'zalo_notifications') return notificationsQuery;
        if (name === 'users') return mockQuery();
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.students.map((student: { id: string }) => student.id)).toEqual([
      'class-student-1',
      'class-student-2',
    ]);
    expect(res.body.data.summaries['class-1']).toMatchObject({
      eligibleStudentCount: 2,
      finalEvaluationCount: 0,
      isEvaluationComplete: false,
      missingEvaluationStudentIds: ['class-student-1', 'class-student-2'],
    });
  });

  it('keeps later office academic classes from being starved by the row cap for earlier classes', async () => {
    const classesQuery = mockQuery([
      mockDoc('crowded-class', {
        name: 'Crowded Class',
        teacherId: 'teacher-1',
        status: 'active',
      }),
      mockDoc('later-class', {
        name: 'Later Class',
        teacherId: 'teacher-2',
        status: 'active',
      }),
    ]);
    const studentDocs = [
      ...Array.from({ length: 200 }, (_, index) =>
        mockDoc(`crowded-student-${index}`, {
          name: `Crowded Student ${index}`,
          studentId: `HS-A-${index}`,
          classId: 'crowded-class',
          enrollmentStatus: 'active',
        })
      ),
      mockDoc('later-student', {
        name: 'Later Student',
        studentId: 'HS-B-001',
        classId: 'later-class',
        enrollmentStatus: 'active',
      }),
    ];
    let studentLimit = studentDocs.length;
    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn((limit: number) => {
        studentLimit = limit;
        return studentsQuery;
      }),
      get: vi.fn().mockImplementation(async () => ({ docs: studentDocs.slice(0, studentLimit) })),
    };
    const evaluationsQuery = mockQuery([]);
    const ledgersQuery = mockQuery([]);
    const notificationsQuery = mockQuery([]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'zalo_notifications') return notificationsQuery;
        if (name === 'users') return mockQuery();
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.students.map((student: { id: string }) => student.id)).toContain(
      'later-student'
    );
    expect(res.body.data.summaries['later-class']).toMatchObject({
      eligibleStudentCount: 1,
      finalEvaluationCount: 0,
      isEvaluationComplete: false,
      missingEvaluationStudentIds: ['later-student'],
    });
  });

  it('only treats current reset-course records as office academic current data', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: 'Reset Class',
        teacherId: 'teacher-1',
        status: 'active',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        terms: [
          {
            id: 'term-old',
            name: 'Old course',
            startDate: '2026-05-01',
            endDate: '2026-05-31',
          },
        ],
      }),
    ]);
    const studentsQuery = mockQuery([
      mockDoc('student-1', {
        name: 'Current Student',
        studentId: 'HS001',
        classId: 'class-1',
        enrollmentStatus: 'active',
      }),
    ]);
    const evaluationsQuery = mockQuery([
      mockDoc('eval-old-final', {
        studentId: 'student-1',
        classId: 'class-1',
        evaluationType: 'final',
        totalScore: 9,
        date: '2026-05-31',
      }),
    ]);
    const ledgersQuery = mockQuery([
      mockDoc('ledger-old', {
        studentId: 'student-1',
        classId: 'class-1',
        amount: 1000000,
        termStart: '2026-05-01',
        termEnd: '2026-05-31',
      }),
      mockDoc('ledger-current', {
        studentId: 'student-1',
        classId: 'class-1',
        amount: 1000000,
        termStart: '2026-06-01',
        termEnd: '2026-06-30',
      }),
    ]);
    const notificationsQuery = mockQuery([
      mockDoc('zalo-old-tuition', {
        studentId: 'student-1',
        classId: 'class-1',
        type: 'next_course_tuition',
        status: 'sent',
        date: '2026-05-20',
        courseEndDate: '2026-05-31',
      }),
      mockDoc('zalo-old-evaluation', {
        studentId: 'student-1',
        classId: 'class-1',
        type: 'evaluation',
        status: 'sent',
        date: '2026-05-31',
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'student_course_enrollments') {
          return mockQuery([
            mockDoc('enrollment-student-1', {
              studentId: 'student-1',
              classId: 'class-1',
              termStart: '2026-06-01',
              status: 'active',
            }),
          ]);
        }
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'zalo_notifications') return notificationsQuery;
        if (name === 'users') return mockQuery();
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.evaluations).toEqual([]);
    expect(res.body.data.ledgers.map((ledger: { id: string }) => ledger.id)).toEqual([
      'ledger-current',
    ]);
    expect(res.body.data.notifications).toEqual([]);
    expect(res.body.data.summaries['class-1']).toMatchObject({
      eligibleStudentCount: 1,
      finalEvaluationCount: 0,
      isEvaluationComplete: false,
      evaluationSentCount: 0,
      tuitionNoticeSentCount: 0,
      missingEvaluationStudentIds: ['student-1'],
    });
  });

  it('hides paused and archived classes from office academic but keeps ended active classes', async () => {
    const classesQuery = mockQuery([
      mockDoc('current-class', {
        name: 'Current Class',
        teacherId: 'teacher-1',
        status: 'active',
        endDate: '2999-12-31',
      }),
      mockDoc('ended-class', {
        name: 'Ended Class',
        teacherId: 'teacher-1',
        status: 'active',
        endDate: '2000-01-01',
      }),
      mockDoc('paused-class', {
        name: 'Paused Class',
        teacherId: 'teacher-1',
        status: 'paused',
        endDate: '2999-12-31',
      }),
      mockDoc('archived-class', {
        name: 'Archived Class',
        teacherId: 'teacher-1',
        status: 'archived',
        endDate: '2999-12-31',
      }),
    ]);
    const studentsQuery = mockQuery([
      mockDoc('current-student', {
        name: 'Current Student',
        studentId: 'HS001',
        classId: 'current-class',
        enrollmentStatus: 'active',
      }),
      mockDoc('ended-student', {
        name: 'Ended Student',
        studentId: 'HS002',
        classId: 'ended-class',
        enrollmentStatus: 'active',
      }),
      mockDoc('paused-student', {
        name: 'Paused Student',
        studentId: 'HS004',
        classId: 'paused-class',
        enrollmentStatus: 'active',
      }),
      mockDoc('archived-student', {
        name: 'Archived Student',
        studentId: 'HS003',
        classId: 'archived-class',
        enrollmentStatus: 'active',
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'evaluations') return mockQuery();
        if (name === 'course_fee_ledgers') return mockQuery();
        if (name === 'zalo_notifications') return mockQuery();
        if (name === 'users') return mockQuery();
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.classes.map((classRow: { id: string }) => classRow.id)).toEqual([
      'current-class',
      'ended-class',
    ]);
    expect(res.body.data.students.map((student: { id: string }) => student.id)).toEqual([
      'current-student',
      'ended-student',
    ]);
    expect(res.body.data.summaries).toHaveProperty('ended-class');
    expect(res.body.data.summaries).not.toHaveProperty('paused-class');
    expect(res.body.data.summaries).not.toHaveProperty('archived-class');
  });

  it('rejects non-office academic summary reads', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-uid',
      role: 'teacher',
      email: 'teacher@test.com',
    } as any);
    vi.mocked(requireRole).mockImplementation(() => {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => mockQuery()),
    } as any);

    const res = mockRes();
    try {
      await handler({ method: 'GET', query: { channel: 'office-academic' } } as any, res);
    } finally {
      vi.mocked(requireRole).mockImplementation(() => undefined as any);
    }

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ success: false, errorCode: 'forbidden' }));
  });
});

describe('read API office-weekly-dashboard channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'office-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'office-uid',
      role: 'office',
      email: 'office@test.com',
      isBlocked: false,
    } as any);
    vi.mocked(getClassGrade).mockImplementation(
      (data: any) =>
        data.grade || (data.name?.includes('G9') ? 9 : data.name?.includes('G5') ? 5 : 0)
    );
  });

  it('returns fixed weekly dashboard data with ended active classes and active/on-leave counts', async () => {
    vi.mocked(requireRole).mockImplementation(() => undefined as any);
    const classesQuery = mockQuery([
      mockDoc('active-class', {
        name: 'G5 Starters',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-06-01',
        endDate: '2026-08-29',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        status: 'active',
        grade: 5,
        weeklySessions: [
          { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
          { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
        ],
      }),
      mockDoc('ended-class', {
        name: 'G9 IELTS Foundation',
        teacherId: 'teacher-2',
        daysOfWeek: [1],
        startDate: '2026-03-01',
        endDate: '2026-05-31',
        startTime: '19:15',
        schedule: '19:15 - 20:45',
        room: 'Room 4',
        status: 'active',
      }),
      mockDoc('archived-class', {
        name: 'Archived G3',
        teacherId: 'teacher-1',
        daysOfWeek: [2],
        startDate: '2026-01-01',
        endDate: '2026-03-01',
        status: 'archived',
      }),
    ]);
    const studentsQuery = mockQuery([
      mockDoc('student-1', { classId: 'active-class', enrollmentStatus: 'active' }),
      mockDoc('student-2', { classId: 'active-class', enrollmentStatus: 'on_leave' }),
      mockDoc('student-3', { classId: 'active-class', enrollmentStatus: 'dropped' }),
      mockDoc('student-4', { classId: 'active-class', studentLifecycle: 'trial' }),
      mockDoc('student-5', { classId: 'ended-class', enrollmentStatus: 'active' }),
      mockDoc('student-6', { classId: 'archived-class', enrollmentStatus: 'active' }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Teacher One',
        email: 'one@test.com',
      }),
      mockDoc('teacher-2', {
        role: 'teacher',
        displayName: 'Teacher Two',
        email: 'two@test.com',
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'users') return usersQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'office-weekly-dashboard', limit: '2000' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(expect.objectContaining({ role: 'office' }), [
      'office',
    ]);
    expect(res.body.data.classes.map((row: { id: string }) => row.id)).toEqual([
      'active-class',
      'ended-class',
    ]);
    expect(res.body.data.classes[0]).toMatchObject({
      id: 'active-class',
      name: 'G5 Starters',
      teacherId: 'teacher-1',
      grade: 5,
      daysOfWeek: [1, 3],
    });
    expect(res.body.data.classes[0].weeklySessions).toEqual([
      { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
      { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
    ]);
    expect(res.body.data.classes[1]).toMatchObject({
      id: 'ended-class',
      grade: 9,
    });
    expect(res.body.data.studentCounts).toEqual({
      'active-class': { currentTotal: 2, active: 1, onLeave: 1 },
      'ended-class': { currentTotal: 1, active: 1, onLeave: 0 },
    });
    expect(res.body.data.teachers).toEqual([
      { uid: 'teacher-1', displayName: 'Teacher One', email: 'one@test.com' },
      { uid: 'teacher-2', displayName: 'Teacher Two', email: 'two@test.com' },
    ]);
    expect(typeof res.body.data.serverTime).toBe('number');
  });

  it('rejects non-office users', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-uid',
      role: 'teacher',
      email: 'teacher@test.com',
      isBlocked: false,
    } as any);
    vi.mocked(requireRole).mockImplementation((ctx: any, roles: string[]) => {
      if (!roles.includes(ctx.role)) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      return undefined as any;
    });
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn(() => mockQuery()) } as any);

    const res = mockRes();
    try {
      await handler({ method: 'GET', query: { channel: 'office-weekly-dashboard' } } as any, res);
    } finally {
      vi.mocked(requireRole).mockImplementation(() => undefined as any);
    }

    expect(res.statusCode).toBe(403);
  });
});

describe('read API bounded operational channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'admin-uid',
      role: 'admin',
      email: 'admin@test.com',
    } as any);
  });

  it('returns an admin dashboard summary from the dashboard read model', async () => {
    const studentsQuery = mockQuery([
      mockDoc('student-1', {
        name: 'Student One',
        studentId: 'HS260001',
        classId: 'class-1',
        gender: 'female',
        enrollmentStatus: 'active',
        loginPasswordHash: 'secret-hash',
        internalFinanceNote: 'hidden',
      }),
    ]);
    const classesQuery = mockQuery([
      mockDoc('class-1', { name: 'Class A', teacherId: 'teacher-1', status: 'active' }),
      mockDoc('class-ended', {
        name: 'Ended Class',
        teacherId: 'teacher-1',
        status: 'active',
        endDate: '2000-01-01',
      }),
      mockDoc('class-archived', {
        name: 'Archived Class',
        teacherId: 'teacher-1',
        status: 'archived',
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        displayName: 'Teacher One',
        email: 'teacher@example.com',
        role: 'teacher',
        phone: '0901234567',
        createdAt: '2020-01-31T03:00:00.000Z',
      }),
      mockDoc('office-1', {
        displayName: 'Front Desk',
        email: 'frontdesk.office@nancy.com',
        role: 'office',
        phone: '0907654321',
        createdAt: '2021-02-01T03:00:00.000Z',
      }),
      mockDoc('accounting-1', {
        displayName: 'Finance Team',
        email: 'finance.accounting@nancy.com',
        role: 'accounting',
        phone: '0902222222',
        createdAt: '2022-03-01T03:00:00.000Z',
      }),
    ]);
    const evaluationsQuery = mockQuery([
      mockDoc('evaluation-1', {
        studentId: 'student-1',
        classId: 'class-1',
        date: '2026-05-20',
        finalScore: 9,
        privateComment: 'hidden',
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'read_models') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(
                mockExistingDoc('dashboard_global', {
                  counts: {
                    students: 120,
                    currentStudents: 120,
                    classes: 12,
                    activeClasses: 10,
                    teachers: 8,
                    pendingPayments: 3,
                    paymentsNeedingReview: 1,
                    failedNotifications: 2,
                  },
                  sourceVersions: { students: 31 },
                  generatedAt: new Date().toISOString(),
                  schemaVersion: 3,
                  performanceCounts: { excellent: 4, good: 3, fair: 2, average: 1 },
                })
              ),
            })),
          };
        }
        if (name === 'realtime_events') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ data: () => ({ version: 31 }) }),
            })),
          };
        }
        if (name === 'students') return studentsQuery;
        if (name === 'classes') return classesQuery;
        if (name === 'users') return usersQuery;
        if (name === 'evaluations') return evaluationsQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'admin-dashboard-summary' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary).toMatchObject({
      totalStudents: 120,
      activeClasses: 10,
      attendanceToday: { present: 0, absent: 0, late: 0 },
      financeSummary: { pendingPayments: 3, paymentsNeedingReview: 1 },
      recentAlerts: expect.arrayContaining([
        { id: 'payments_review', type: 'payments_needing_review', count: 1 },
      ]),
    });
    expect(res.body.data.students).toEqual([]);
    expect(res.body.data.classes).toEqual([
      { id: 'class-1', name: 'Class A', teacherId: 'teacher-1', status: 'active' },
      {
        id: 'class-ended',
        name: 'Ended Class',
        teacherId: 'teacher-1',
        status: 'active',
        endDate: '2000-01-01',
      },
      { id: 'class-archived', name: 'Archived Class', teacherId: 'teacher-1', status: 'archived' },
    ]);
    const expectedStaff = [
      {
        uid: 'teacher-1',
        displayName: 'Teacher One',
        email: 'teacher@example.com',
        role: 'teacher',
        phone: '0901234567',
        createdAt: '2020-01-31T03:00:00.000Z',
      },
      {
        uid: 'office-1',
        displayName: 'Front Desk',
        email: 'frontdesk.office@nancy.com',
        role: 'office',
        phone: '0907654321',
        createdAt: '2021-02-01T03:00:00.000Z',
      },
      {
        uid: 'accounting-1',
        displayName: 'Finance Team',
        email: 'finance.accounting@nancy.com',
        role: 'accounting',
        phone: '0902222222',
        createdAt: '2022-03-01T03:00:00.000Z',
      },
    ];
    expect(res.body.data.staff).toEqual(expectedStaff);
    expect(res.body.data.teachers).toEqual(expectedStaff);
    expect(usersQuery.where).toHaveBeenCalledWith('role', 'in', [
      'teacher',
      'office',
      'accounting',
    ]);
    expect(res.body.data.evaluations).toEqual([]);
    expect(res.body.data.performanceCounts).toEqual({
      excellent: 4,
      good: 3,
      fair: 2,
      average: 1,
    });
    expect(studentsQuery.limit).not.toHaveBeenCalled();
    expect(classesQuery.limit).toHaveBeenCalledWith(2000);
    expect(usersQuery.limit).toHaveBeenCalledWith(2000);
    expect(evaluationsQuery.limit).not.toHaveBeenCalled();
  });

  it('rebuilds a stale schema-2 dashboard model instead of serving its old total', async () => {
    vi.mocked(aggregateDashboardReadModel).mockResolvedValue({
      id: 'dashboard_global',
      counts: {
        students: 754,
        currentStudents: 638,
        classes: 20,
        activeClasses: 18,
        teachers: 10,
        pendingPayments: 2,
        paymentsNeedingReview: 0,
        failedNotifications: 0,
      },
      classStudentCounts: {},
      activeStudents: 610,
      genderCounts: { male: 310, female: 300, other: 28 },
      performanceCounts: { excellent: 10, good: 20, fair: 30, average: 5 },
      sourceVersions: { students: 55 },
      generatedAt: '2026-08-10T12:00:00.000Z',
      schemaVersion: 3,
    });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'read_models') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  counts: { students: 468 },
                  generatedAt: '2026-07-18T12:30:47.844Z',
                  schemaVersion: 2,
                }),
              }),
            })),
          };
        }
        if (name === 'realtime_events') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ data: () => ({ version: 55 }) }),
            })),
          };
        }
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'admin-dashboard-summary' } } as any, res);

    expect(aggregateDashboardReadModel).toHaveBeenCalledOnce();
    expect(res.body.data.summary).toMatchObject({ totalStudents: 638, activeStudents: 610 });
    expect(res.body.data.performanceCounts.excellent).toBe(10);
  });

  it('rejects accounting users from the staff-bearing admin dashboard summary', async () => {
    const accountingCtx = {
      uid: 'accounting-uid',
      role: 'accounting',
      email: 'accounting@test.com',
    } as any;
    vi.mocked(getUserContext).mockResolvedValue(accountingCtx);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn(() => mockQuery()),
    } as any);
    vi.mocked(requireRole).mockImplementation((ctx: any, roles: string[]) => {
      if (!roles.includes(ctx.role)) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      return undefined as any;
    });

    const res = mockRes();
    try {
      await handler({ method: 'GET', query: { channel: 'admin-dashboard-summary' } } as any, res);
    } finally {
      vi.mocked(requireRole).mockImplementation(() => undefined as any);
    }

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ success: false, errorCode: 'forbidden' }));
    expect(requireRole).toHaveBeenCalledWith(accountingCtx, ['admin']);
  });

  it('rejects calendar windows larger than 45 days', async () => {
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn(() => mockQuery()) } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'calendar-window', from: '2026-05-01', to: '2026-06-30' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('45 days');
  });

  it('returns bounded calendar data for a valid window', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: 'Class A',
        teacherId: 'teacher-1',
        status: 'active',
        grade: 5,
        schedule: '17:30 - 19:00',
        daysOfWeek: [1, 3],
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        startTime: '17:30',
        room: 'Room 101',
        holidays: ['2026-05-15'],
      }),
    ]);
    const attendanceQuery = mockQuery([
      mockDoc('attendance-1', { classId: 'class-1', date: '2026-05-02', status: 'present' }),
    ]);
    const holidaysDoc = mockExistingDoc('holidays', { dates: ['2026-05-10', '2026-05-11'] });
    const holidaysQuery = {
      get: vi.fn().mockResolvedValue(holidaysDoc),
    };

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'attendance') return attendanceQuery;
        if (name === 'system_settings') {
          return {
            doc: vi.fn((id: string) => {
              if (id === 'holidays') return holidaysQuery;
              return { get: vi.fn().mockResolvedValue(mockDoc(id, {})) };
            }),
          };
        }
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'calendar-window', from: '2026-05-01', to: '2026-05-31' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(attendanceQuery.where).toHaveBeenCalledWith('date', '>=', '2026-05-01');
    expect(attendanceQuery.where).toHaveBeenCalledWith('date', '<=', '2026-05-31');
    expect(attendanceQuery.select).toHaveBeenCalledWith('classId', 'date');
    expect(attendanceQuery.limit).not.toHaveBeenCalled();
    expect(res.body.data).toMatchObject({
      window: { from: '2026-05-01', to: '2026-05-31' },
      systemHolidays: ['2026-05-10', '2026-05-11'],
      classes: [
        {
          id: 'class-1',
          name: 'Class A',
          teacherId: 'teacher-1',
          status: 'active',
          grade: 5,
          schedule: '17:30 - 19:00',
          daysOfWeek: [1, 3],
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          startTime: '17:30',
          room: 'Room 101',
          holidays: ['2026-05-15'],
        },
      ],
      attendance: expect.any(Array),
      attendanceCounts: { 'class-1::2026-05-02': 1 },
      meta: { complete: true, totalAttendanceRecords: 1 },
    });
  });

  it('returns monthly finance reports through a bounded read channel', async () => {
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn(() => mockQuery()) } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'reports-monthly', month: '2026-05' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assertFinanceAccess).toHaveBeenCalled();
    expect(buildFinanceReport).toHaveBeenCalledWith(expect.anything(), {
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
    expect(res.body.data.report).toMatchObject({ source: 'aggregate', balance: 750 });
  });

  it('returns academic monthly reports through a bounded server projection', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-1',
      role: 'teacher',
      name: 'Teacher One',
      email: 'teacher@example.com',
    } as any);

    const classDoc = mockDoc('class-1', {
      name: 'Class A',
      teacherId: 'teacher-1',
      status: 'active',
    });
    const studentDoc = mockDoc('student-1', {
      name: 'Student A',
      studentId: 'HS001',
      classId: 'class-1',
      teacherId: 'teacher-1',
      studentLifecycle: 'enrolled',
      loginPasswordHash: 'secret',
    });
    const classesQuery = mockQuery([classDoc]);
    const studentsQuery = mockQuery([studentDoc]);
    const enrollmentsQuery = mockQuery([
      mockDoc('enrollment-1', {
        studentId: 'student-1',
        classId: 'class-1',
        termStart: '2026-01-01',
        termEnd: '2026-12-31',
        status: 'active',
        joinedAt: '2026-01-01',
        endedAt: null,
        source: 'system',
        confidence: 'confirmed',
      }),
    ]);
    const attendanceQuery = mockQuery([
      mockDoc('att-1', { classId: 'class-1', date: '2026-05-02' }),
    ]);
    const assignmentsQuery = mockQuery([mockDoc('assignment-1', { classId: 'class-1' })]);
    const submissionsQuery = mockQuery([mockDoc('submission-1', { classId: 'class-1' })]);
    const evaluationsQuery = mockQuery([mockDoc('evaluation-1', { classId: 'class-1' })]);
    const collection = vi.fn((name: string) => {
      if (name === 'classes') return classesQuery;
      if (name === 'students') return studentsQuery;
      if (name === 'student_course_enrollments') return enrollmentsQuery;
      if (name === 'attendance') return attendanceQuery;
      if (name === 'assignments') return assignmentsQuery;
      if (name === 'submissions') return submissionsQuery;
      if (name === 'evaluations') return evaluationsQuery;
      return mockQuery();
    });
    const missingDoc = makeDocumentStoreDocSnapshot({
      id: 'missing',
      path: 'test/missing',
      exists: false,
    });
    vi.mocked(getDb).mockReturnValue({
      collection,
      doc: vi.fn((path: string) => ({
        get: vi
          .fn()
          .mockResolvedValue(
            path === 'students/student-1'
              ? studentDoc
              : path === 'classes/class-1'
                ? classDoc
                : missingDoc
          ),
      })),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'reports-monthly', scope: 'academic', month: '2026-05' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assertFinanceAccess).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'teacher', 'office']);
    expect(classesQuery.where).toHaveBeenCalledWith('teacherId', '==', 'teacher-1');
    expect(attendanceQuery.where).toHaveBeenCalledWith('date', '>=', '2026-04-01');
    expect(attendanceQuery.where).toHaveBeenCalledWith('date', '<', '2026-06-01');
    expect(submissionsQuery.where).toHaveBeenCalledWith('submittedAt', '>=', '2026-05-01');
    expect(evaluationsQuery.where).toHaveBeenCalledWith('date', '<', '2026-06-01');
    expect(res.body.data.students[0]).toMatchObject({
      id: 'student-1',
      name: 'Student A',
      studentId: 'HS001',
      classId: 'class-1',
    });
    expect(res.body.data.students[0]).not.toHaveProperty('loginPasswordHash');
    expect(res.body.data.teachers).toEqual([
      {
        uid: 'teacher-1',
        displayName: 'Teacher One',
        email: 'teacher@example.com',
        role: 'teacher',
      },
    ]);
    expect(res.body.data.page).toMatchObject({ limit: 2000 });
  });
});

describe('read API parent dashboard channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'parent-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'parent-uid',
      role: 'parent',
      studentId: 'student-1',
      classId: 'class-1',
    } as any);
    vi.mocked(assertCanReadStudentScopedResource).mockResolvedValue({
      name: 'Student A',
      studentId: 'HS001',
      classId: 'class-1',
      teacherId: 'teacher-1',
      loginPasswordHash: 'secret-hash',
    } as any);
  });

  it('returns a bounded parent dashboard payload with tuition data', async () => {
    const queries = {
      assignments: mockQuery([
        mockDoc('assignment-1', {
          classId: 'class-1',
          title: 'Homework',
          answerKey: ['A'],
          examIntegrity: { threshold: 2 },
        }),
      ]),
      attendance: mockQuery([
        mockDoc('attendance-1', { studentId: 'student-1', teacherNote: 'hidden' }),
      ]),
      evaluations: mockQuery([
        mockDoc('evaluation-1', { studentId: 'student-1', privateComment: 'hidden' }),
      ]),
      submissions: mockQuery([
        mockDoc('submission-1', {
          studentId: 'student-1',
          quizAnswers: ['secret'],
          proctoringEvents: [{ type: 'blur' }],
        }),
      ]),
      notifications: mockQuery([
        mockDoc('notification-1', { studentId: 'student-1', payload: { internal: true } }),
      ]),
      ledgers: mockQuery([mockDoc('ledger-1', { studentId: 'student-1', internalNote: 'secret' })]),
      receipts: mockQuery([
        mockDoc('receipt-1', { studentId: 'student-1', status: 'posted', systemUid: 'internal' }),
      ]),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(
                mockExistingDoc('student-1', {
                  name: 'Student A',
                  studentId: 'HS001',
                  classId: 'class-1',
                  teacherId: 'teacher-1',
                  loginPasswordHash: 'secret-hash',
                })
              ),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(mockExistingDoc('class-1', { name: 'Class A' })),
            })),
          };
        }
        if (name === 'assignments') return queries.assignments;
        if (name === 'attendance') return queries.attendance;
        if (name === 'evaluations') return queries.evaluations;
        if (name === 'submissions') return queries.submissions;
        if (name === 'notifications') return queries.notifications;
        if (name === 'course_fee_ledgers') return queries.ledgers;
        if (name === 'receipts') return queries.receipts;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'parent-dashboard' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      dashboard: {
        student: expect.objectContaining({ id: 'student-1' }),
        classInfo: expect.objectContaining({ id: 'class-1' }),
        assignments: expect.any(Array),
        attendance: expect.any(Array),
        evaluations: expect.any(Array),
        submissions: expect.any(Array),
        notifications: expect.any(Array),
        tuition: {
          ledgers: expect.any(Array),
          receipts: expect.any(Array),
        },
      },
    });
    expect(JSON.stringify(res.body.data.dashboard.student)).not.toContain('loginPasswordHash');
    expect(JSON.stringify(res.body.data.dashboard.assignments)).not.toContain('answerKey');
    expect(JSON.stringify(res.body.data.dashboard.assignments)).not.toContain('examIntegrity');
    expect(JSON.stringify(res.body.data.dashboard.attendance)).not.toContain('teacherNote');
    expect(JSON.stringify(res.body.data.dashboard.evaluations)).not.toContain('privateComment');
    expect(JSON.stringify(res.body.data.dashboard.submissions)).not.toContain('quizAnswers');
    expect(JSON.stringify(res.body.data.dashboard.submissions)).not.toContain('proctoringEvents');
    expect(JSON.stringify(res.body.data.dashboard.notifications)).not.toContain('payload');
    expect(JSON.stringify(res.body.data.dashboard.tuition.ledgers)).not.toContain('internalNote');
    expect(JSON.stringify(res.body.data.dashboard.tuition.receipts)).not.toContain('systemUid');
  });

  it('caps parent tuition reads to the parent dashboard limit', async () => {
    const queries = {
      ledgers: mockQuery([
        mockDoc('ledger-1', {
          studentId: 'student-1',
          amount: 1000000,
          paidTotal: 200000,
          discountTotal: 0,
          status: 'partial',
          termStart: '2026-05-01',
          termEnd: '2026-05-31',
          internalNote: 'hidden',
        }),
      ]),
      receipts: mockQuery([
        mockDoc('receipt-1', {
          studentId: 'student-1',
          amount: 200000,
          status: 'posted',
          receivedDate: '2026-05-20',
          systemUid: 'internal-uid',
        }),
      ]),
      invoices: mockQuery([
        mockDoc('invoice-1', {
          studentId: 'student-1',
          amount: 1000000,
          amountPaid: 200000,
          status: 'partial',
          issueDate: '2026-05-01',
          dueDate: '2026-05-31',
          internalNote: 'hidden',
          systemUid: 'internal-uid',
        }),
      ]),
      payments: mockQuery([
        mockDoc('payment-1', {
          studentId: 'student-1',
          amount: 500000,
          status: 'pending',
          orderCode: 2605160001,
          checkoutUrl: 'https://pay.example/checkout',
          rawWebhook: { secret: 'raw-payload' },
          gatewaySnapshot: { accountNumber: '123456' },
          reconciliationLeaseUntil: '2026-05-16T01:00:00.000Z',
        }),
      ]),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'course_fee_ledgers') return queries.ledgers;
        if (name === 'receipts') return queries.receipts;
        if (name === 'invoices') return queries.invoices;
        if (name === 'payment_requests') return queries.payments;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'parent-tuition', limit: '500' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(queries.ledgers.limit).toHaveBeenCalledWith(500);
    expect(queries.receipts.limit).toHaveBeenCalledWith(500);
    expect(queries.invoices.limit).toHaveBeenCalledWith(500);
    expect(queries.payments.limit).toHaveBeenCalledWith(500);
    expect(res.body.data.payments).toEqual([
      {
        id: 'payment-1',
        amount: 500000,
        status: 'pending',
        orderCode: 2605160001,
        checkoutUrl: 'https://pay.example/checkout',
      },
    ]);
    expect(JSON.stringify(res.body.data.payments)).not.toContain('raw-payload');
    expect(JSON.stringify(res.body.data.payments)).not.toContain('gatewaySnapshot');
    expect(JSON.stringify(res.body.data.payments)).not.toContain('reconciliationLeaseUntil');
    expect(res.body.data.ledgers[0]).toEqual({
      id: 'ledger-1',
      amount: 1000000,
      paidTotal: 200000,
      discountTotal: 0,
      status: 'partial',
      termStart: '2026-05-01',
      termEnd: '2026-05-31',
    });
    expect(res.body.data.receipts[0]).toEqual({
      id: 'receipt-1',
      amount: 200000,
      status: 'posted',
      receivedDate: '2026-05-20',
    });
    expect(res.body.data.invoices[0]).toEqual({
      id: 'invoice-1',
      amount: 1000000,
      amountPaid: 200000,
      status: 'partial',
      issueDate: '2026-05-01',
      dueDate: '2026-05-31',
    });
    expect(JSON.stringify(res.body.data)).not.toContain('internalNote');
    expect(JSON.stringify(res.body.data)).not.toContain('systemUid');
  });

  it.each(['parent', 'student'] as const)(
    'filters dashboard assignments to class-wide and self-targeted only for %s',
    async (role) => {
      vi.mocked(getUserContext).mockResolvedValue({
        uid: `${role}-uid`,
        role,
        studentId: 'student-1',
        classId: 'class-1',
      } as any);

      const assignmentsQuery = mockQuery([
        mockDoc('assignment-cw', { classId: 'class-1', title: 'Class Wide' }),
        mockDoc('assignment-in', {
          classId: 'class-1',
          title: 'Targeted In',
          deliveryPolicy: { targetMode: 'selected_students', assignedStudentIds: ['student-1'] },
        }),
        mockDoc('assignment-out', {
          classId: 'class-1',
          title: 'Targeted Out',
          deliveryPolicy: {
            targetMode: 'selected_students',
            assignedStudentIds: ['other-student'],
          },
        }),
        mockDoc('assignment-malformed', {
          classId: 'class-1',
          title: 'Malformed',
          deliveryPolicy: { targetMode: 'selected_students' },
        }),
      ]);
      vi.mocked(getDb).mockReturnValue({
        collection: vi.fn((name: string) => {
          if (name === 'students') {
            return {
              doc: vi.fn(() => ({
                get: vi
                  .fn()
                  .mockResolvedValue(
                    mockExistingDoc('student-1', { name: 'Student A', classId: 'class-1' })
                  ),
              })),
            };
          }
          if (name === 'classes') {
            return {
              doc: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(mockExistingDoc('class-1', { name: 'Class A' })),
              })),
            };
          }
          if (name === 'assignments') return assignmentsQuery;
          return mockQuery();
        }),
      } as any);

      const res = mockRes();
      await handler({ method: 'GET', query: { channel: 'parent-dashboard' } } as any, res);

      expect(res.statusCode).toBe(200);
      const ids = res.body.data.dashboard.assignments.map((a: any) => a.id).sort();
      expect(ids).toEqual(['assignment-cw', 'assignment-in']);
    }
  );
});

describe('read API assignment projection', () => {
  it('projects student assignments and submissions without internal anti-cheat fields', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'student-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
    } as any);

    const assignmentsQuery = mockQuery([
      mockDoc('assignment-1', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        title: 'Essay',
        description: 'Write an essay',
        dueDate: '2026-06-01',
        type: 'writing',
        proctoringMode: 'normal',
        deliveryPolicy: {
          targetMode: 'selected_students',
          assignedStudentIds: ['student-1'],
          availableFrom: '',
          resultReleasePolicy: 'after_submit',
        },
        examIntegrity: { threshold: 2 },
        answerKey: ['A'],
        internalNote: 'teacher-only',
      }),
    ]);
    const submissionsQuery = mockQuery([
      mockDoc('submission-1', {
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        grade: 8,
        submittedAt: '2026-05-31T10:00:00.000Z',
        autoSubmitted: true,
        autoSubmitReason: 'tab-switch',
        quizAnswers: { q1: 'A' },
        internalGradingTrace: 'hidden',
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'assignments') return assignmentsQuery;
        if (name === 'submissions') return submissionsQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'assignments' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.assignments[0]).toEqual({
      id: 'assignment-1',
      classId: 'class-1',
      teacherId: 'teacher-1',
      title: 'Essay',
      description: 'Write an essay',
      dueDate: '2026-06-01',
      type: 'writing',
      proctoringMode: 'normal',
      deliveryPolicy: {
        targetMode: 'selected_students',
        assignedStudentIds: ['student-1'],
        availableFrom: '',
        resultReleasePolicy: 'after_submit',
      },
    });
    expect(res.body.data.submissions[0]).toMatchObject({
      id: 'submission-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      grade: 8,
      submittedAt: '2026-05-31T10:00:00.000Z',
      quizAnswers: { q1: 'A' },
    });
    expect(JSON.stringify(res.body.data)).not.toContain('examIntegrity');
    expect(JSON.stringify(res.body.data)).not.toContain('answerKey');
    expect(JSON.stringify(res.body.data)).not.toContain('tab-switch');
    expect(JSON.stringify(res.body.data)).not.toContain('internalGradingTrace');
  });

  it('projects assessment v2 media safely for student assignments', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'student-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
    } as any);

    const assignmentsQuery = mockQuery([
      mockDoc('assignment-assessment', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        title: 'Listening quiz',
        description: 'Listen and answer',
        dueDate: '2026-06-01',
        type: 'quiz',
        assessment: {
          version: 2,
          mode: 'practice',
          settings: {
            showTranscriptDuringAttempt: false,
          },
          sections: [
            {
              id: 'listening',
              title: 'Listening',
              skill: 'listening',
              questions: [
                {
                  id: 'q1',
                  skill: 'listening',
                  prompt: 'What does the speaker want?',
                  responseMode: 'multiple_choice',
                  media: [
                    {
                      id: 'm1',
                      type: 'audio',
                      source: 'external_url',
                      url: 'https://cdn.example.com/q1.mp3',
                      transcript: 'Hidden transcript',
                      displayMode: 'hidden_until_review',
                    },
                  ],
                  options: [
                    { key: 'A', text: 'A ticket' },
                    { key: 'B', text: 'A book' },
                  ],
                  correctAnswer: 'B',
                  rubric: [{ id: 'choice', label: 'Correct choice', maxPoints: 1 }],
                },
              ],
            },
          ],
        },
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'assignments') return assignmentsQuery;
        if (name === 'submissions') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'assignments' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.assignments[0].assessment.sections[0].questions[0]).toMatchObject({
      id: 'q1',
      prompt: 'What does the speaker want?',
      responseMode: 'multiple_choice',
      media: [
        {
          id: 'm1',
          type: 'audio',
          source: 'external_url',
          url: 'https://cdn.example.com/q1.mp3',
          displayMode: 'hidden_until_review',
        },
      ],
    });
    expect(JSON.stringify(res.body.data.assignments[0])).not.toContain('Hidden transcript');
    expect(JSON.stringify(res.body.data.assignments[0])).not.toContain('correctAnswer');
    expect(JSON.stringify(res.body.data.assignments[0])).not.toContain('rubric');
  });

  it('defaults legacy student assignments to strict proctoring mode', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'student-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
    } as any);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'assignments') {
          return mockQuery([
            mockDoc('assignment-legacy', {
              classId: 'class-1',
              teacherId: 'teacher-1',
              title: 'Legacy Essay',
              dueDate: '2026-06-01',
              type: 'essay',
            }),
          ]);
        }
        if (name === 'submissions') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'assignments' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.assignments[0]).toMatchObject({
      id: 'assignment-legacy',
      proctoringMode: 'strict',
    });
  });

  it('filters assignments visible to student based on delivery policies', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'student-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'student-uid',
      role: 'student',
      studentId: 'student-1',
      classId: 'class-1',
    } as any);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'assignments') {
          return mockQuery([
            mockDoc('assignment-class-wide', {
              classId: 'class-1',
              title: 'Class Assignment',
              dueDate: '2026-06-01',
              type: 'essay',
            }),
            mockDoc('assignment-selected-included', {
              classId: 'class-1',
              title: 'Selected Included',
              dueDate: '2026-06-01',
              type: 'essay',
              deliveryPolicy: {
                targetMode: 'selected_students',
                assignedStudentIds: ['student-1'],
                availableFrom: '2026-06-01T10:00:00.000Z',
                resultReleasePolicy: 'after_submit',
              },
            }),
            mockDoc('assignment-selected-excluded', {
              classId: 'class-1',
              title: 'Selected Excluded',
              dueDate: '2026-06-01',
              type: 'essay',
              deliveryPolicy: {
                targetMode: 'selected_students',
                assignedStudentIds: ['student-2'],
                availableFrom: '2026-06-01T10:00:00.000Z',
                resultReleasePolicy: 'after_submit',
              },
            }),
            mockDoc('assignment-future', {
              classId: 'class-1',
              title: 'Future Assignment',
              dueDate: '2026-06-01',
              type: 'essay',
              deliveryPolicy: {
                targetMode: 'class',
                assignedStudentIds: [],
                availableFrom: '2999-01-01T10:00:00.000Z',
                resultReleasePolicy: 'after_submit',
              },
            }),
          ]);
        }
        if (name === 'submissions') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'assignments' } } as any, res);

    expect(res.statusCode).toBe(200);
    const assignmentIds = res.body.data.assignments.map((a: any) => a.id);
    expect(assignmentIds).toContain('assignment-class-wide');
    expect(assignmentIds).toContain('assignment-selected-included');
    expect(assignmentIds).not.toContain('assignment-selected-excluded');
    expect(assignmentIds).not.toContain('assignment-future');
  });
});

describe('read API notification projection', () => {
  it('projects parent notifications without internal payload metadata', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'parent-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'parent-uid',
      role: 'parent',
      studentId: 'student-1',
      classId: 'class-1',
    } as any);

    const notificationsQuery = mockQuery([
      mockDoc('notification-1', {
        studentId: 'student-1',
        classId: 'class-1',
        title: 'Reminder',
        message: 'Bring workbook',
        type: 'general',
        payload: { token: 'secret' },
        internalMetadata: { source: 'system' },
      }),
    ]);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'notifications') return notificationsQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'notifications' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.notifications[0]).toMatchObject({
      id: 'notification-1',
      studentId: 'student-1',
      classId: 'class-1',
      title: 'Reminder',
      message: 'Bring workbook',
      type: 'general',
    });
    expect(res.body.data.notifications[0]).not.toHaveProperty('payload');
    expect(res.body.data.notifications[0]).not.toHaveProperty('internalMetadata');
  });
});

describe('read API class-detail authorization', () => {
  const allowedRoles = [
    ['admin', 'admin-uid'],
    ['teacher', 'teacher-uid'],
    ['office', 'office-uid'],
  ] as const;

  const deniedContexts = [
    [
      'student',
      { uid: 'student-uid', role: 'student', studentId: 'student-1', classId: 'class-1' },
    ],
    ['parent', { uid: 'parent-uid', role: 'parent', studentId: 'student-1', classId: 'class-1' }],
    ['accounting', { uid: 'accounting-uid', role: 'accounting' }],
    ['missing role', { uid: 'missing-role-uid', role: '' }],
    ['unknown role', { uid: 'future-role-uid', role: 'future_role' }],
  ] as const;

  function createClassDetailDb() {
    const docsByCollection: Record<string, Array<ReturnType<typeof mockDoc>>> = {
      students: [
        mockDoc('student-1', {
          name: 'Student',
          studentId: 'HS260011',
          dob: '2012-01-01',
          classId: 'class-1',
          contact: '0384072314',
          faceImage: 'face-data',
          faceImageStoragePath: 'faces/student-1.jpg',
          internalOnly: 'server-only',
        }),
      ],
      attendance: [
        mockDoc('attendance-1', {
          studentId: 'student-1',
          classId: 'class-1',
          date: '2026-05-01',
          status: 'present',
        }),
      ],
      evaluations: [
        mockDoc('evaluation-1', {
          studentId: 'student-1',
          classId: 'class-1',
          date: '2026-05-02',
          totalScore: 86,
        }),
      ],
      class_sessions: [
        mockDoc('session-1', {
          classId: 'class-1',
          date: '2026-05-03',
          topic: 'Speaking',
        }),
      ],
      dailyReports: [
        mockDoc('report-1', {
          studentId: 'student-1',
          classId: 'class-1',
          date: '2026-05-04',
          summary: 'Good',
        }),
      ],
    };
    const collection = vi.fn((name: string) => mockQuery(docsByCollection[name] || []));
    return { db: { collection } as any, collection };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'test-uid' } as any);
    const actualAuthz = await vi.importActual<typeof import('../../server/api/lib/auth/authz.js')>(
      '../../server/api/lib/auth/authz.js'
    );
    vi.mocked(requireRole).mockImplementation(actualAuthz.requireRole);
  });

  afterEach(() => {
    vi.mocked(requireRole).mockImplementation(() => undefined as any);
  });

  it.each(allowedRoles)('allows %s to read the full class-detail payload', async (role, uid) => {
    const context = { uid, role };
    vi.mocked(getUserContext).mockResolvedValue(context as any);
    vi.mocked(assertClassAccess).mockResolvedValue({
      name: 'Class A',
      teacherId: 'teacher-uid',
    });
    const { db, collection } = createClassDetailDb();
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'class-detail', classId: 'class-1' } } as any,
      res
    );

    expect(requireRole).toHaveBeenCalledWith(context, ['admin', 'teacher', 'office']);
    expect(assertClassAccess).toHaveBeenCalledWith(db, context, 'class-1', 'read');
    expect(collection).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.students[0]).toMatchObject({
      studentId: 'HS260011',
      dob: '2012-01-01',
      contact: '0384072314',
      faceImage: 'face-data',
    });
    expect(res.body.data.students[0]).not.toHaveProperty('internalOnly');
    expect(res.body.data.attendance).toHaveLength(1);
    expect(res.body.data.evaluations).toHaveLength(1);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.reports).toHaveLength(1);
  });

  it.each(deniedContexts)(
    'denies %s before class access or class-detail collection reads',
    async (_label, context) => {
      vi.mocked(getUserContext).mockResolvedValue(context as any);
      vi.mocked(assertClassAccess).mockResolvedValue({ name: 'Class A' });
      const collection = vi.fn(() => {
        throw new Error('class-detail collection read should not run');
      });
      vi.mocked(getDb).mockReturnValue({ collection } as any);

      const res = mockRes();
      await handler(
        { method: 'GET', query: { channel: 'class-detail', classId: 'class-1' } } as any,
        res
      );

      expect(requireRole).toHaveBeenCalledWith(context, ['admin', 'teacher', 'office']);
      expect(res.statusCode).toBe(403);
      expect(res.body?.data).toBeUndefined();
      expect(assertClassAccess).not.toHaveBeenCalled();
      expect(collection).not.toHaveBeenCalled();
    }
  );
});

describe('read API accounting students channel', () => {
  it('serves the admin ledger-only view without rebuilding the student directory', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({ uid: 'admin-uid', role: 'admin' } as any);

    const ledgersQuery = mockQuery([
      mockDoc('ledger-1', {
        studentId: 'student-1',
        amount: 100,
        status: 'open',
        internalNote: 'secret',
      }),
    ]);
    const collection = vi.fn((name: string) => {
      if (name === 'course_fee_ledgers') return ledgersQuery;
      throw new Error(`Unexpected collection read: ${name}`);
    });
    vi.mocked(getDb).mockReturnValue({ collection } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'accounting-students', view: 'ledgers', limit: '2000' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(collection).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledWith('course_fee_ledgers');
    expect(ledgersQuery.limit).toHaveBeenCalledWith(2001);
    expect(res.body.data.ledgers).toEqual([
      expect.objectContaining({ id: 'ledger-1', studentId: 'student-1', amount: 100 }),
    ]);
    expect(res.body.data.ledgers[0]).not.toHaveProperty('internalNote');
    expect(res.body.data.ledgerTruncated).toBe(false);
  });

  it('bounds accounting student ledger reads to the current page with a fixed cap', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);

    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      startAfter: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({
        docs: Array.from({ length: 30 }, (_, index) =>
          mockDoc(`student-${index + 1}`, { name: `Student ${index + 1}` })
        ),
      }),
    };
    const ledgersQuery: any = {
      where: vi.fn(() => ledgersQuery),
      limit: vi.fn(() => ledgersQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };
    const classesQuery = mockQuery([]);
    const teachersQuery = mockQuery([]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'classes') return classesQuery;
        if (name === 'users') return teachersQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'accounting-students', limit: '2000' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(studentsQuery.limit).toHaveBeenCalledWith(2001);
    expect(ledgersQuery.limit).toHaveBeenCalledWith(150);
    expect(ledgersQuery.limit).not.toHaveBeenCalledWith(10000);
  });

  it('projects accounting student ledgers without internal fields', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);

    const studentsQuery = mockQuery([mockDoc('student-1', { name: 'Student 1' })]);
    const ledgersQuery = mockQuery([
      mockDoc('ledger-1', {
        studentId: 'student-1',
        amount: 100,
        status: 'open',
        internalNote: 'secret',
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'classes') return mockQuery([]);
        if (name === 'users') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'accounting-students' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.ledgers[0]).toMatchObject({
      id: 'ledger-1',
      studentId: 'student-1',
      amount: 100,
      status: 'open',
    });
    expect(res.body.data.ledgers[0]).not.toHaveProperty('internalNote');
  });

  it('caps accounting student ledgers globally and reports truncation metadata', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);

    const studentsQuery = mockQuery(
      Array.from({ length: 90 }, (_, index) =>
        mockDoc(`student-${index + 1}`, { name: `Student ${index + 1}` })
      )
    );
    let ledgerQueryIndex = 0;
    const ledgerQueries = Array.from({ length: 3 }, (_, chunkIndex) =>
      mockQuery(
        Array.from({ length: 150 }, (_, index) =>
          mockDoc(`ledger-${chunkIndex + 1}-${index + 1}`, {
            studentId: `student-${chunkIndex * 30 + 1}`,
            amount: index,
            status: 'open',
          })
        )
      )
    );

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'course_fee_ledgers')
          return ledgerQueries[ledgerQueryIndex++] ?? mockQuery([]);
        if (name === 'classes') return mockQuery([]);
        if (name === 'users') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'accounting-students', limit: '90' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.ledgers).toHaveLength(300);
    expect(res.body.data.ledgerLimit).toBe(300);
    expect(res.body.data.ledgerTruncated).toBe(true);
  });

  it('deduplicates accounting student ledgers returned by multiple chunks', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);

    const studentsQuery = mockQuery(
      Array.from({ length: 31 }, (_, index) =>
        mockDoc(`student-${index + 1}`, { name: `Student ${index + 1}` })
      )
    );
    let ledgerQueryIndex = 0;
    const ledgerQueries = [
      mockQuery([
        mockDoc('ledger-duplicate', { studentId: 'student-1', amount: 100, status: 'open' }),
        mockDoc('ledger-a', { studentId: 'student-2', amount: 200, status: 'open' }),
      ]),
      mockQuery([
        mockDoc('ledger-duplicate', { studentId: 'student-31', amount: 300, status: 'open' }),
        mockDoc('ledger-b', { studentId: 'student-31', amount: 400, status: 'open' }),
      ]),
    ];

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'course_fee_ledgers')
          return ledgerQueries[ledgerQueryIndex++] ?? mockQuery([]);
        if (name === 'classes') return mockQuery([]);
        if (name === 'users') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'accounting-students', limit: '31' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(
      res.body.data.ledgers.filter((ledger: { id: string }) => ledger.id === 'ledger-duplicate')
    ).toHaveLength(1);
  });

  it('attaches a sibling and their ledger while leaving the page cursor unchanged', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);

    const studentA = mockDoc('student-a', { name: 'An', siblingGroupId: 'g1' });
    const studentB = mockDoc('student-b', { name: 'Binh', siblingGroupId: 'g1' });

    const siblingGroupQuery: any = {
      where: vi.fn(() => siblingGroupQuery),
      get: vi.fn().mockResolvedValue({ docs: [studentA, studentB] }),
    };
    const studentsQuery: any = {
      where: vi.fn((field: string) =>
        field === 'siblingGroupId' ? siblingGroupQuery : studentsQuery
      ),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      startAfter: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({ docs: [studentA] }),
    };

    const ledgerStudentIds: string[] = [];
    const ledgerQuery: any = {
      where: vi.fn((_field: string, _op: string, ids: string[]) => {
        ledgerStudentIds.push(...ids);
        return ledgerQuery;
      }),
      limit: vi.fn(() => ledgerQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'course_fee_ledgers') return ledgerQuery;
        if (name === 'classes') return mockQuery([]);
        if (name === 'users') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'accounting-students' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(ledgerStudentIds.sort()).toEqual(['student-a', 'student-b']);
    expect(res.body.data.students.map((s: { id: string }) => s.id)).toEqual([
      'student-a',
      'student-b',
    ]);
    expect(res.body.data.page.nextCursor).toBeNull();
    expect(res.body.data.page.hasMore).toBe(false);
  });
});

describe('read API teacher-attendance-week channel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'office-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'office-uid',
      role: 'office',
      email: 'office@test.com',
      isBlocked: false,
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns scheduled, makeup, and cancelled teacher attendance rows', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: '6A Global Success',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        salaryPerSession: 200000,
        status: 'active',
        weeklySessions: [
          { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
          { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
        ],
      }),
    ]);
    const sessionsQuery = mockQuery([
      mockDoc('class-1_2026-06-03', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-03',
        status: 'cancelled',
        salaryPerSession: 200000,
      }),
      mockDoc('class-1_2026-06-05', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-05',
        status: 'makeup',
        salaryPerSession: 200000,
        teacherAttendanceStatus: 'present',
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Teacher One',
        email: 'teacher@test.com',
      }),
    ]);
    const substituteQuery = mockQuery([]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return substituteQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'teacher-attendance-week', from: '2026-06-01', to: '2026-06-07' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class-1_2026-06-01',
          classId: 'class-1',
          teacherId: 'teacher-1',
          teacherName: 'Teacher One',
          date: '2026-06-01',
          sessionKind: 'scheduled',
          teacherAttendanceStatus: 'pending',
          isVirtual: true,
          canMark: true,
          startTime: '17:30',
          schedule: '17:30 - 19:00',
          room: 'Room 2',
        }),
        expect.objectContaining({
          id: 'class-1_2026-06-03',
          sessionStatus: 'cancelled',
          sessionKind: 'cancelled',
          teacherAttendanceStatus: 'pending',
          isVirtual: false,
          canMark: false,
          disabledReason: 'cancelled',
          startTime: '19:15',
          schedule: '19:15 - 20:45',
          room: 'Room 4',
        }),
        expect.objectContaining({
          id: 'class-1_2026-06-05',
          sessionStatus: 'makeup',
          sessionKind: 'makeup',
          teacherAttendanceStatus: 'present',
          isVirtual: false,
          canMark: true,
        }),
      ])
    );
    expect(res.body.data.teachers).toEqual([
      { uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@test.com' },
    ]);
  });

  it('rejects teacher role reads for the weekly teacher attendance page', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-1',
      role: 'teacher',
      email: 'teacher@test.com',
      isBlocked: false,
    } as any);
    vi.mocked(requireRole).mockImplementation(() => {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    });
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn(() => mockQuery()) } as any);

    const res = mockRes();
    try {
      await handler(
        {
          method: 'GET',
          query: { channel: 'teacher-attendance-week', from: '2026-06-01', to: '2026-06-07' },
        } as any,
        res
      );
    } finally {
      vi.mocked(requireRole).mockImplementation(() => undefined as any);
    }

    expect(res.statusCode).toBe(403);
  });

  it('prefers accepted substitute teacher over an existing session teacher', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: '6A Global Success',
        teacherId: 'teacher-1',
        daysOfWeek: [1],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        status: 'active',
      }),
    ]);
    const sessionsQuery = mockQuery([
      mockDoc('class-1_2026-06-01', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-01',
        status: 'taught',
        salaryPerSession: 200000,
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Original Teacher',
        email: 'original@test.com',
      }),
      mockDoc('teacher-2', {
        role: 'teacher',
        displayName: 'Substitute Teacher',
        email: 'sub@test.com',
      }),
    ]);
    const substituteQuery = mockQuery([
      mockDoc('sub-1', {
        classId: 'class-1',
        date: '2026-06-01',
        status: 'accepted',
        substituteTeacherId: 'teacher-2',
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return substituteQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'teacher-attendance-week', from: '2026-06-01', to: '2026-06-07' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class-1_2026-06-01',
          teacherId: 'teacher-2',
          teacherName: 'Substitute Teacher',
        }),
      ])
    );
  });

  it('does not generate virtual rows for an archived class whose endDate is still in the future', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-archived', {
        name: 'G1 - Mr. Minh',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-05-01',
        endDate: '2026-08-16',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        status: 'archived',
        archivedAt: '2026-05-20T10:00:00.000Z',
      }),
    ]);
    const sessionsQuery = mockQuery([]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', { role: 'teacher', displayName: 'Mr. Minh', email: 'minh@test.com' }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'teacher-attendance-week', from: '2026-06-01', to: '2026-06-07' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.sessions).toEqual([]);
  });

  it('keeps marked history but hides pending sessions dated after a class was archived', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-archived', {
        name: 'G1 - Mr. Minh',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-05-01',
        endDate: '2026-08-16',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        status: 'archived',
        archivedAt: '2026-06-03T10:00:00.000Z',
      }),
    ]);
    const sessionsQuery = mockQuery([
      // taught + already marked before archiving -> must stay (payroll evidence)
      mockDoc('class-archived_2026-06-01', {
        classId: 'class-archived',
        teacherId: 'teacher-1',
        date: '2026-06-01',
        status: 'taught',
        teacherAttendanceStatus: 'present',
      }),
      // pending, dated after archivedAt -> must be hidden
      mockDoc('class-archived_2026-06-05', {
        classId: 'class-archived',
        teacherId: 'teacher-1',
        date: '2026-06-05',
        status: 'taught',
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', { role: 'teacher', displayName: 'Mr. Minh', email: 'minh@test.com' }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'teacher-attendance-week', from: '2026-06-01', to: '2026-06-07' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.sessions.map((row: { id: string }) => row.id)).toEqual([
      'class-archived_2026-06-01',
    ]);
  });

  it('drops source-class sessions from the promotion date, even when already marked', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-old', {
        name: 'G1 - Mr. Minh',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-05-01',
        endDate: '2026-08-16',
        startTime: '17:30',
        status: 'archived',
      }),
      mockDoc('class-new', {
        name: 'G2 - Mr. Minh',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-06-03',
        endDate: '2026-08-16',
        startTime: '17:30',
        status: 'active',
        importSourceClassId: 'class-old',
        promotedAt: '2026-06-03T15:25:43.407Z',
      }),
    ]);
    const sessionsQuery = mockQuery([
      // before the promotion -> the teacher really taught this, keep it
      mockDoc('class-old_2026-06-01', {
        classId: 'class-old',
        teacherId: 'teacher-1',
        date: '2026-06-01',
        status: 'taught',
        teacherAttendanceStatus: 'present',
      }),
      // on/after the promotion -> pay follows the new class, drop despite being marked
      mockDoc('class-old_2026-06-03', {
        classId: 'class-old',
        teacherId: 'teacher-1',
        date: '2026-06-03',
        status: 'taught',
        teacherAttendanceStatus: 'present',
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', { role: 'teacher', displayName: 'Mr. Minh', email: 'minh@test.com' }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'teacher-attendance-week', from: '2026-06-01', to: '2026-06-07' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const ids = res.body.data.sessions.map((row: { id: string }) => row.id);
    expect(ids).toContain('class-old_2026-06-01');
    expect(ids).not.toContain('class-old_2026-06-03');
  });

  it('keeps pending real sessions of an archived class that has no archivedAt recorded', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-archived', {
        name: 'G3',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-05-01',
        endDate: '2026-08-22',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        status: 'archived',
      }),
    ]);
    const sessionsQuery = mockQuery([
      mockDoc('class-archived_2026-06-03', {
        classId: 'class-archived',
        teacherId: 'teacher-1',
        date: '2026-06-03',
        status: 'taught',
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', { role: 'teacher', displayName: 'Teacher One', email: 't@test.com' }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return mockQuery([]);
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'teacher-attendance-week', from: '2026-06-01', to: '2026-06-07' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.sessions.map((row: { id: string }) => row.id)).toEqual([
      'class-archived_2026-06-03',
    ]);
  });
});

describe('read API office-teachers-month channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'office-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'office-uid',
      role: 'office',
      email: 'office@test.com',
      isBlocked: false,
    } as any);
  });

  it('returns office teacher month data with teacher phones and bounded sessions', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: '6A Global Success',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        status: 'active',
        holidays: ['2026-06-10'],
        salaryPerSession: 150000,
      }),
    ]);
    const sessionsQuery = mockQuery([
      mockDoc('class-1_2026-06-03', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-03',
        status: 'taught',
        teacherAttendanceStatus: 'present',
      }),
      mockDoc('class-1_2026-06-05', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-05',
        status: 'makeup',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 175000,
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Teacher One',
        email: 'teacher@test.com',
        phone: '0384072314',
      }),
    ]);
    const substituteQuery = mockQuery([]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return substituteQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'office-teachers-month', month: '2026-06' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(expect.objectContaining({ role: 'office' }), [
      'office',
      'admin',
    ]);
    expect(res.body.data.month).toBe('2026-06');
    expect(res.body.data.range).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(res.body.data.teachers).toEqual([
      {
        uid: 'teacher-1',
        displayName: 'Teacher One',
        email: 'teacher@test.com',
        phone: '0384072314',
        blockedTeacher: false,
      },
    ]);
    expect(res.body.data.classes).toEqual([
      expect.objectContaining({
        id: 'class-1',
        name: '6A Global Success',
        teacherId: 'teacher-1',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        holidays: ['2026-06-10'],
      }),
    ]);
    expect(res.body.data.classes[0]).not.toHaveProperty('salaryPerSession');
    expect(res.body.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class-1_2026-06-03',
          classId: 'class-1',
          teacherId: 'teacher-1',
          date: '2026-06-03',
          status: 'taught',
          teacherAttendanceStatus: 'present',
        }),
        expect.objectContaining({
          id: 'class-1_2026-06-05',
          status: 'makeup',
          teacherAttendanceStatus: 'present',
        }),
      ])
    );
    expect(res.body.data.sessions.every((session: any) => !('salaryPerSession' in session))).toBe(
      true
    );
  });

  it('allows admin access to the office teacher month channel', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'admin-uid',
      role: 'admin',
      email: 'admin@test.com',
      isBlocked: false,
    } as any);
    vi.mocked(requireRole).mockImplementation((ctx: any, roles: string[]) => {
      if (!roles.includes(ctx.role)) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      return undefined as any;
    });
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn(() => mockQuery()) } as any);

    const res = mockRes();
    try {
      await handler(
        { method: 'GET', query: { channel: 'office-teachers-month', month: '2026-06' } } as any,
        res
      );
    } finally {
      vi.mocked(requireRole).mockImplementation(() => undefined as any);
    }

    expect(res.statusCode).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), [
      'office',
      'admin',
    ]);
  });

  it('rejects invalid month parameters', async () => {
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn(() => mockQuery()) } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'office-teachers-month', month: '2026-13' } } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid teacher month');
  });
});

describe('read API teacher-payroll-month channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
      email: 'accounting@test.com',
      isBlocked: false,
    } as any);
  });

  it('allows accounting to read the unified teacher payroll month data', async () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: '6A Global Success',
        teacherId: 'teacher-1',
        daysOfWeek: [1],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        status: 'active',
        salaryPerSession: 150000,
      }),
    ]);
    const sessionsQuery = mockQuery([
      mockDoc('class-1_2026-06-01', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-01',
        status: 'taught',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 175000,
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Teacher One',
        email: 'teacher@test.com',
      }),
    ]);
    const substituteQuery = mockQuery([]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return substituteQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'teacher-payroll-month', month: '2026-06' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(expect.objectContaining({ role: 'accounting' }), [
      'admin',
      'accounting',
      'office',
      'teacher',
    ]);
    expect(res.body.data.month).toBe('2026-06');
    expect(res.body.data.range).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(res.body.data.classes).toEqual([
      expect.objectContaining({
        id: 'class-1',
        salaryPerSession: 150000,
      }),
    ]);
    expect(res.body.data.sessions).toEqual([
      expect.objectContaining({
        id: 'class-1_2026-06-01',
        teacherId: 'teacher-1',
        salaryPerSession: 175000,
      }),
    ]);
  });

  it('scopes teacher reads to their own and substitute payroll data', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'teacher-2' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-2',
      role: 'teacher',
      email: 'sub@test.com',
      isBlocked: false,
    } as any);

    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: 'Original Class',
        teacherId: 'teacher-1',
        daysOfWeek: [1],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        status: 'active',
        salaryPerSession: 150000,
      }),
      mockDoc('class-2', {
        name: 'Own Class',
        teacherId: 'teacher-2',
        daysOfWeek: [2],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '19:15',
        schedule: '19:15 - 20:45',
        status: 'active',
        salaryPerSession: 160000,
      }),
      mockDoc('class-3', {
        name: 'Other Class',
        teacherId: 'teacher-3',
        daysOfWeek: [3],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '15:45',
        schedule: '15:45 - 17:15',
        status: 'active',
        salaryPerSession: 170000,
      }),
    ]);
    const sessionsQuery = mockQuery([
      mockDoc('class-1_2026-06-01', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-01',
        status: 'taught',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 200000,
      }),
      mockDoc('class-2_2026-06-02', {
        classId: 'class-2',
        teacherId: 'teacher-2',
        date: '2026-06-02',
        status: 'taught',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 160000,
      }),
      mockDoc('class-3_2026-06-03', {
        classId: 'class-3',
        teacherId: 'teacher-3',
        date: '2026-06-03',
        status: 'taught',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 170000,
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Original Teacher',
        email: 'original@test.com',
      }),
      mockDoc('teacher-2', {
        role: 'teacher',
        displayName: 'Substitute Teacher',
        email: 'sub@test.com',
      }),
      mockDoc('teacher-3', {
        role: 'teacher',
        displayName: 'Other Teacher',
        email: 'other@test.com',
      }),
    ]);
    const substituteQuery = mockQuery([
      mockDoc('sub-1', {
        classId: 'class-1',
        date: '2026-06-01',
        status: 'accepted',
        substituteTeacherId: 'teacher-2',
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return substituteQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'teacher-payroll-month', month: '2026-06' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.teachers).toEqual([
      expect.objectContaining({
        uid: 'teacher-2',
        displayName: 'Substitute Teacher',
      }),
    ]);
    expect(res.body.data.classes.map((cls: any) => cls.id)).toEqual(['class-1', 'class-2']);
    expect(res.body.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class-1_2026-06-01',
          teacherId: 'teacher-2',
          salaryPerSession: 200000,
        }),
        expect.objectContaining({
          id: 'class-2_2026-06-02',
          teacherId: 'teacher-2',
          salaryPerSession: 160000,
        }),
      ])
    );
    expect(res.body.data.sessions).toHaveLength(2);
    expect(res.body.data.substitutes).toEqual([
      {
        classId: 'class-1',
        date: '2026-06-01',
        substituteTeacherId: 'teacher-2',
      },
    ]);
  });
});

describe('read API auth flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses verified auth context without loading user context again', async () => {
    const verifyAuthContextMock = vi.mocked(verifyAuthContext).mockImplementation(async () => {
      return {
        decoded: { uid: 'admin-1', email: 'admin@example.com' } as any,
        context: {
          uid: 'admin-1',
          email: 'admin@example.com',
          role: 'admin',
          name: 'Admin One',
          isBlocked: false,
        },
      } as any;
    });

    const db = {
      collection: vi.fn((name: string) => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ id: 'dashboard_global', counts: {} }),
          }),
        })),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [] }),
        where: vi.fn().mockReturnThis(),
      })),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    await handler({ method: 'GET', query: { channel: 'dashboard-aggregate' } } as any, mockRes());

    expect(verifyAuthContextMock).toHaveBeenCalledTimes(1);
  });

  it('caches admin dashboard summary as final payload instead of DocumentStore snapshots', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'admin-1', email: 'admin@example.com' },
      context: {
        uid: 'admin-1',
        email: 'admin@example.com',
        role: 'admin',
        name: 'Admin One',
        isBlocked: false,
      },
    } as any);

    const readModelGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        counts: { students: 10, currentStudents: 10 },
        sourceVersions: { students: 5 },
        generatedAt: new Date().toISOString(),
        schemaVersion: 3,
      }),
    });
    const studentsEventGet = vi.fn().mockResolvedValue({ data: () => ({ version: 5 }) });
    const emptyQuery = {
      limit: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'read_models') return { doc: vi.fn(() => ({ get: readModelGet })) };
        if (name === 'realtime_events') {
          return { doc: vi.fn(() => ({ get: studentsEventGet })) };
        }
        return emptyQuery;
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    await handler(
      { method: 'GET', query: { channel: 'admin-dashboard-summary' } } as any,
      mockRes()
    );
    await handler(
      { method: 'GET', query: { channel: 'admin-dashboard-summary' } } as any,
      mockRes()
    );

    expect(readModelGet).toHaveBeenCalledTimes(1);
  });

  it('emits Server-Timing for read requests when API timing diagnostics are enabled', async () => {
    const previousDebugTiming = process.env.API_DEBUG_TIMING;
    process.env.API_DEBUG_TIMING = '1';
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'admin-1', email: 'admin@example.com' },
      context: {
        uid: 'admin-1',
        email: 'admin@example.com',
        role: 'admin',
        name: 'Admin One',
        isBlocked: false,
      },
    } as any);

    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'read_models') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ counts: { students: 10 } }),
              }),
            })),
          };
        }
        return mockQuery();
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'dashboard-aggregate' } } as any, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Server-Timing',
      expect.stringContaining('auth;dur=')
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Server-Timing',
      expect.stringContaining('read_dashboard-aggregate;dur=')
    );

    if (previousDebugTiming === undefined) delete process.env.API_DEBUG_TIMING;
    else process.env.API_DEBUG_TIMING = previousDebugTiming;
  });

  it('does not read the class document twice for class-detail', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'teacher-1' } as any,
      context: { uid: 'teacher-1', role: 'teacher', name: 'Teacher One' },
    });
    vi.mocked(assertClassAccess).mockImplementation(async (db, ctx, classId) => {
      const snap = await db.collection('classes').doc(classId).get();
      return snap.data();
    });

    const classDocGet = vi.fn().mockResolvedValue(
      mockExistingDoc('class-1', {
        name: 'Class One',
        teacherId: 'teacher-1',
        status: 'active',
      })
    );
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: classDocGet,
            })),
          };
        }
        return mockQuery([]);
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'class-detail', classId: 'class-1' } } as any,
      res as any
    );

    expect(classDocGet).toHaveBeenCalledTimes(1);
  });

  it('caches parent tuition payload by parent and student context', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'parent-1' } as any,
      context: {
        uid: 'parent-1',
        role: 'parent',
        name: 'Parent One',
        studentId: 'student-1',
      },
    });

    const ledgersGet = vi.fn().mockResolvedValue({ docs: [] });
    const db = {
      collection: vi.fn((name: string) => {
        const q = {
          where: vi.fn(() => q),
          orderBy: vi.fn(() => q),
          limit: vi.fn(() => q),
          get: ledgersGet,
        };
        return q;
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res1 = mockRes();
    const res2 = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'parent-tuition', limit: '10' } } as any,
      res1 as any
    );
    await handler(
      { method: 'GET', query: { channel: 'parent-tuition', limit: '10' } } as any,
      res2 as any
    );

    expect(ledgersGet).toHaveBeenCalledTimes(4);
  });

  it('returns office-academic summary view without heavy row arrays', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'office-1' } as any,
      context: { uid: 'office-1', role: 'office', name: 'Office One' },
    });
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: 'Class A',
        status: 'active',
        currentCourseId: 'course-1',
      }),
    ]);
    const usersQuery = mockQuery([]);
    const studentsQuery = mockQuery([]);
    const evaluationsQuery = mockQuery([]);
    const ledgersQuery = mockQuery([]);
    const notificationsQuery = mockQuery([]);
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'users') return usersQuery;
        if (name === 'students') return studentsQuery;
        if (name === 'evaluations') return evaluationsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'zalo_notifications') return notificationsQuery;
        return mockQuery();
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'office-academic', view: 'summary' } } as any,
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.classes).toBeDefined();
    expect(payload.data.summaries).toBeDefined();
    expect(payload.data.students).toEqual([]);
    expect(payload.data.evaluations).toEqual([]);
    expect(payload.data.ledgers).toEqual([]);
    expect(payload.data.notifications).toEqual([]);
    expect(payload.data.summaries['class-1'].courseClosing).toMatchObject({
      courseId: 'course-1',
      status: 'no_required_students',
    });
    expect(studentsQuery.where).toHaveBeenCalledWith('classId', 'in', ['class-1']);
    expect(evaluationsQuery.where).toHaveBeenCalledWith('classId', 'in', ['class-1']);
    expect(ledgersQuery.where).toHaveBeenCalledWith('classId', 'in', ['class-1']);
    expect(notificationsQuery.where).toHaveBeenCalledWith('courseId', 'in', ['course-1']);
    expect(notificationsQuery.orderBy).not.toHaveBeenCalled();
  });

  it('returns teacher references without reading classes or academic detail collections', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'office-1' } as any,
      context: { uid: 'office-1', role: 'office', name: 'Office One' },
    });
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Teacher One',
        email: 'teacher@example.com',
        phone: '+84384072314',
        blockedTeacher: false,
      }),
    ]);
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'users') return usersQuery;
        return mockQuery();
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'office-academic', view: 'teacher-references' },
      } as any,
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      classes: [],
      teachers: [
        {
          uid: 'teacher-1',
          displayName: 'Teacher One',
          email: 'teacher@example.com',
          phone: '+84384072314',
          blockedTeacher: false,
        },
      ],
    });
    expect(usersQuery.where).toHaveBeenCalledWith('role', '==', 'teacher');
    expect(db.collection).not.toHaveBeenCalledWith('classes');
    expect(db.collection).not.toHaveBeenCalledWith('students');
    expect(db.collection).not.toHaveBeenCalledWith('evaluations');
    expect(db.collection).not.toHaveBeenCalledWith('course_fee_ledgers');
    expect(db.collection).not.toHaveBeenCalledWith('zalo_notifications');
  });
});

// ---------------------------------------------------------------------------
// student-admin-report channel tests
// ---------------------------------------------------------------------------

describe('read API student-admin-report channel', () => {
  function makeStudentAdminDb(
    studentExists = true,
    seed: Record<string, any[]> = {},
    classes: Record<string, any> = {},
    studentOverrides: Record<string, any> = {}
  ) {
    const studentDoc = {
      exists: studentExists,
      id: 'stu-1',
      data: () =>
        studentExists
          ? {
              name: 'Nguyen Van A',
              studentId: 'HS001',
              classId: 'class-1',
              teacherId: 'teacher-1',
              enrollmentStatus: 'active',
              studentLifecycle: 'enrolled',
              enrollmentDate: '2026-01-01T00:00:00.000Z',
              ...studentOverrides,
            }
          : undefined,
    };
    const makeQuery = (docs: any[] = []) => {
      const q: any = {
        where: vi.fn(() => q),
        orderBy: vi.fn(() => q),
        limit: vi.fn(() => q),
        limitToLast: vi.fn(() => q),
        startAfter: vi.fn(() => q),
        get: vi.fn().mockResolvedValue({ docs }),
      };
      return q;
    };
    const toDocs = (rows: any[]) =>
      rows.map((row) => ({ id: row.id, data: () => row, exists: true }));
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(studentDoc) })),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs: [] }),
          };
        }
        if (name === 'classes') {
          const classQuery = makeQuery(
            Object.entries(classes).map(([id, data]) => ({ id, data: () => data, exists: true }))
          );
          // Teacher authorization reads the class behind the open enrollment,
          // because `students.teacherId` is a projection that goes stale.
          classQuery.doc = vi.fn((id: string) => ({
            id,
            get: vi
              .fn()
              .mockResolvedValue({ id, exists: Boolean(classes[id]), data: () => classes[id] }),
          }));
          return classQuery;
        }
        return makeQuery(toDocs(seed[name] ?? []));
      }),
      // The report resolves its route id before reading anything, and the
      // resolver addresses documents by path. Only the student exists here:
      // no alias, no tombstone, which is the ordinary case.
      doc: vi.fn((path: string) => {
        const [collectionName, id] = [
          path.slice(0, path.indexOf('/')),
          path.slice(path.indexOf('/') + 1),
        ];
        if (collectionName === 'students' && id === 'stu-1') {
          return { id, get: vi.fn().mockResolvedValue(studentDoc) };
        }
        return { id, get: vi.fn().mockResolvedValue({ id, exists: false, data: () => undefined }) };
      }),
    };
    return db;
  }

  function enforceStudentAdminReportRoles(role: string, uid = `${role}-uid`) {
    vi.mocked(getUserContext).mockResolvedValue({ uid, role, name: role } as any);
    vi.mocked(requireRole).mockImplementation((ctx, roles) => {
      if (!roles.includes(ctx.role as any)) {
        throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
      }
    });
  }

  const reportSeed = {
    attendance: [
      {
        id: 'att-1',
        studentId: 'stu-1',
        classId: 'class-1',
        date: '2025-10-07',
        status: 'present',
      },
    ],
    course_fee_ledgers: [
      {
        id: 'ledger-1',
        studentId: 'stu-1',
        amount: 1000000,
        discountTotal: 0,
        paidTotal: 200000,
        classId: 'class-1',
        termStart: '2025-09-01',
        termEnd: '2025-12-31',
        status: 'partial',
      },
    ],
    receipts: [
      {
        id: 'receipt-1',
        ledgerId: 'ledger-1',
        receiptNo: 'R001',
        receivedDate: '2026-01-10',
        amountReceived: 200000,
        paymentMethod: 'cash',
        status: 'posted',
      },
    ],
    class_sessions: [],
  };

  const reportClasses = {
    'class-1': {
      name: 'Advanced 9',
      grade: 9,
      startDate: '2026-05-01',
      endDate: '2026-08-31',
      daysOfWeek: [],
      weeklySessions: [],
      holidays: [],
      terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
    },
  };

  // 2026-01-05 → 2026-03-27, Mondays only: 12 sessions, no holidays.
  const twelveMondayClasses = {
    'class-1': {
      name: 'Advanced 9',
      grade: 9,
      startDate: '2026-01-05',
      endDate: '2026-03-27',
      daysOfWeek: [1],
      weeklySessions: [],
      holidays: [],
      terms: [],
      tuitionFee: 6_000_000,
    },
  };

  const readSessionValue = async (
    seed: Record<string, any[]>,
    classes: Record<string, any>,
    studentOverrides: Record<string, any> = {},
    role = 'admin'
  ) => {
    enforceStudentAdminReportRoles(role, `${role}-uid`);
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(true, seed, classes, studentOverrides) as any
    );
    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    return (res.body as any).data.sessionValueByTerm;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'admin-uid',
      role: 'admin',
      name: 'Admin',
    } as any);
  });

  it('returns a session value estimate keyed by term', async () => {
    // Student joins 2026-02-16 (Monday #7); sessions 1-6 are not_enrolled.
    // Excused on 2026-03-02. 6,000,000 / 12 = 500,000 per session.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T03:00:00.000Z'));
    try {
      const byTerm = await readSessionValue(
        {
          attendance: [
            {
              id: 'att-1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2026-03-02',
              status: 'absent',
              permission: true,
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [],
        },
        twelveMondayClasses,
        { courseJoins: [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-16' }] }
      );

      const value = byTerm['class-1::current'];
      expect(value.courseTotalSessions).toBe(12);
      expect(value.pricePerSession).toBe(500_000);
      expect(value.refundable).toEqual({ sessions: 1, amount: 500_000 });
      expect(value.notEnrolled.sessions).toBe(6);
      expect(value.notEnrolled.amount).toBe(3_000_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts future sessions in the denominator so the unit price is not inflated', async () => {
    // THE regression guard. The reader calls getVietnamTodayStr() internally
    // (readers.ts:1707) — there is no `today` parameter to pass, so the clock
    // MUST be faked. Without this the test passes whether or not the bug exists.
    // Frozen mid-course: a denominator that truncated at today would be ~6.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-09T03:00:00.000Z'));
    try {
      const byTerm = await readSessionValue(
        { attendance: [], course_fee_ledgers: [], receipts: [], class_sessions: [] },
        twelveMondayClasses
      );
      expect(byTerm['class-1::current'].courseTotalSessions).toBe(12);
      expect(byTerm['class-1::current'].pricePerSession).toBe(500_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the denominator stable when a makeup replaces a cancelled session', async () => {
    // 2026-02-02 cancelled, moved to Wednesday 2026-02-04. Still 12 sessions.
    // Subtracting the cancellation without adding the makeup would give 11 and
    // silently raise every student's unit price.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T03:00:00.000Z'));
    try {
      const byTerm = await readSessionValue(
        {
          attendance: [],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [
            { id: 'cs-1', classId: 'class-1', date: '2026-02-02', status: 'cancelled' },
            { id: 'cs-2', classId: 'class-1', date: '2026-02-04', status: 'makeup' },
          ],
        },
        twelveMondayClasses
      );
      expect(byTerm['class-1::current'].courseTotalSessions).toBe(12);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a null price when the class has no tuition fee', async () => {
    const { 'class-1': withFee, ...rest } = twelveMondayClasses;
    const { tuitionFee: _drop, ...noFee } = withFee;
    const byTerm = await readSessionValue(
      { attendance: [], course_fee_ledgers: [], receipts: [], class_sessions: [] },
      { ...rest, 'class-1': noFee }
    );
    expect(byTerm['class-1::current'].pricePerSession).toBeNull();
  });

  it('never prices an archived course from the current class tuitionFee', async () => {
    // terms[] snapshots schedule but NOT money (studentEnrollmentTimeline.ts:105),
    // so class.tuitionFee here belongs to the CURRENT course. With no ledger
    // matching the archived term's bounds, the only honest answer is null.
    const byTerm = await readSessionValue(
      {
        attendance: [
          {
            id: 'att-1',
            studentId: 'stu-1',
            classId: 'class-1',
            date: '2025-10-07',
            status: 'present',
          },
        ],
        course_fee_ledgers: [],
        receipts: [],
        class_sessions: [],
      },
      reportClasses
    );
    expect(byTerm['class-1::term_1'].pricePerSession).toBeNull();
  });

  it('omits sessionValueByTerm for roles without finance access', async () => {
    for (const role of ['office', 'teacher'] as const) {
      const byTerm = await readSessionValue(
        { attendance: [], course_fee_ledgers: [], receipts: [], class_sessions: [] },
        twelveMondayClasses,
        { teacherId: 'teacher-uid' },
        role
      );
      expect(byTerm).toEqual({});
    }
  });

  // Code review fix: an open-ended course must never price itself off "today".
  it('reports a null price for an ongoing course with no endDate, never a shrinking one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-09T03:00:00.000Z'));
    try {
      const openEnded = {
        'class-1': { ...twelveMondayClasses['class-1'], endDate: '' },
      };
      const byTerm = await readSessionValue(
        { attendance: [], course_fee_ledgers: [], receipts: [], class_sessions: [] },
        openEnded
      );
      expect(byTerm['class-1::current'].courseTotalSessions).toBe(0);
      expect(byTerm['class-1::current'].pricePerSession).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Code review fix: a future makeup inside an open leave period must not be
  // priced as an already-occurred refundable session.
  it('excludes a future makeup from refundable sessions even inside an open leave period', async () => {
    // Frozen the day after the course's first Monday session.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-06T03:00:00.000Z'));
    try {
      const byTerm = await readSessionValue(
        {
          attendance: [],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [
            // Both future relative to the frozen clock (2026-01-06).
            { id: 'cs-1', classId: 'class-1', date: '2026-01-19', status: 'cancelled' },
            { id: 'cs-2', classId: 'class-1', date: '2026-01-21', status: 'makeup' },
          ],
        },
        twelveMondayClasses,
        // Starts AFTER "today" (2026-01-06) so the only past/current session
        // (2026-01-05) is untouched by it — isolates the assertion to the
        // future makeup, rather than also catching a real on_leave session.
        { leavePeriods: [{ from: '2026-01-10', until: null, classId: 'class-1' }] }
      );
      const value = byTerm['class-1::current'];
      // Still counted in the whole-course denominator: 11 remaining Mondays
      // (12 minus the cancelled one) plus the makeup's own new date.
      expect(value.courseTotalSessions).toBe(12);
      // ...but not yet in the refundable numerator, because it hasn't happened.
      expect(value.refundable.sessions).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Code review fix: enrollmentDate is written as FieldValue.serverTimestamp(),
  // so on a real document it is a DocumentStore Timestamp, not a string.
  it('reads a DocumentStore-Timestamp-shaped enrollmentDate as the eligibility floor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T03:00:00.000Z'));
    try {
      const byTerm = await readSessionValue(
        { attendance: [], course_fee_ledgers: [], receipts: [], class_sessions: [] },
        twelveMondayClasses,
        // Mimics a DocumentStore Timestamp: has toDate(), not a string.
        { enrollmentDate: { toDate: () => new Date('2026-02-16T00:00:00.000Z') } }
      );
      const value = byTerm['class-1::current'];
      // Sessions 1-6 (2026-01-05 .. 2026-02-09) fall before the floor.
      expect(value.notEnrolled.sessions).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  // Code review fix: the current-term ledger fallback must match on termStart
  // alone; requiring termEnd too rejects legitimate current-course ledgers.
  it('resolves the current-term ledger fallback without requiring an exact termEnd match', async () => {
    const noFeeClasses = {
      'class-1': { ...twelveMondayClasses['class-1'], tuitionFee: 0 },
    };
    const byTerm = await readSessionValue(
      {
        attendance: [],
        course_fee_ledgers: [
          {
            id: 'ledger-1',
            studentId: 'stu-1',
            amount: 6_000_000,
            discountTotal: 0,
            paidTotal: 0,
            classId: 'class-1',
            termStart: '2026-01-05',
            // Deliberately mismatched / stale relative to the class's current endDate.
            termEnd: '',
            status: 'unpaid',
          },
        ],
        receipts: [],
        class_sessions: [],
      },
      noFeeClasses
    );
    expect(byTerm['class-1::current'].pricePerSession).toBe(500_000);
  });

  it('admin reads successfully — returns 200 with expected shape', async () => {
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb() as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data).toHaveProperty('student');
    expect(body.data).toHaveProperty('timeline');
    expect(body.data).toHaveProperty('attendanceRows');
    expect(body.data).toHaveProperty('ledgers');
    expect(body.data).toHaveProperty('receipts');
    expect(body.data).toHaveProperty('truncation');
  });

  it('admin receives academic and finance payloads', async () => {
    enforceStudentAdminReportRoles('admin', 'admin-uid');
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb(true, reportSeed, reportClasses) as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.attendanceRows.length).toBeGreaterThan(0);
    expect(body.data.ledgers.length).toBeGreaterThan(0);
    expect(body.data.receipts.length).toBeGreaterThan(0);
  });

  it('office receives academic payload without querying finance collections', async () => {
    enforceStudentAdminReportRoles('office', 'office-uid');
    const db = makeStudentAdminDb(true, reportSeed, reportClasses);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.attendanceRows.length).toBeGreaterThan(0);
    expect(body.data.ledgers).toEqual([]);
    expect(body.data.receipts).toEqual([]);
    const collections = db.collection.mock.calls.map(([name]: [string]) => name);
    expect(collections).not.toContain('course_fee_ledgers');
    expect(collections).not.toContain('receipts');
  });

  it('teacher receives academic payload for own student without finance payload', async () => {
    enforceStudentAdminReportRoles('teacher', 'teacher-1');
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb(true, reportSeed, reportClasses) as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.attendanceRows.length).toBeGreaterThan(0);
    expect(body.data.ledgers).toEqual([]);
    expect(body.data.receipts).toEqual([]);
  });

  it('teacher receives 404 for a student outside their scope and does not query report collections', async () => {
    enforceStudentAdminReportRoles('teacher', 'teacher-1');
    const db = makeStudentAdminDb(true, reportSeed, reportClasses, { teacherId: 'teacher-2' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(404);
    const collections = db.collection.mock.calls.map(([name]: [string]) => name);
    // Enrollments are read because that is now what decides the answer: class
    // membership, not the profile's stale `teacherId`. No report collection —
    // attendance, ledgers, receipts — is touched for a student the teacher
    // cannot see, which is what this test protects.
    expect(collections).toEqual(['students', 'student_course_enrollments']);
  });

  it('accounting receives finance payload without querying academic collections', async () => {
    enforceStudentAdminReportRoles('accounting', 'accounting-uid');
    const db = makeStudentAdminDb(true, reportSeed, reportClasses);
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.attendanceRows).toEqual([]);
    expect(body.data.ledgers.length).toBeGreaterThan(0);
    expect(body.data.receipts.length).toBeGreaterThan(0);
    const collections = db.collection.mock.calls.map(([name]: [string]) => name);
    expect(collections).not.toContain('attendance');
    expect(collections).not.toContain('class_sessions');
  });

  it('missing studentId returns 400', async () => {
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb() as any);
    vi.mocked(requireRole).mockImplementation(() => {}); // admin passes

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'student-admin-report' } } as any, res);

    expect(res.statusCode).toBe(400);
  });

  it('student not found returns 404', async () => {
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb(false) as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-missing' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(404);
  });

  it.each(['parent', 'student'] as const)('%s role receives 403', async (role) => {
    vi.mocked(getUserContext).mockResolvedValue({ uid: `${role}-uid`, role, name: role } as any);
    vi.mocked(requireRole).mockImplementation((ctx, roles) => {
      if (!roles.includes(ctx.role as any)) {
        throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
      }
    });
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb() as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });

  it('does not leak credential fields in student projection', async () => {
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb() as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { channel: 'student-admin-report', studentId: 'stu-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const student = (res.body as any).data.student;
    expect(student).not.toHaveProperty('loginPasswordHash');
    expect(student).not.toHaveProperty('loginPasswordSalt');
    expect(student).not.toHaveProperty('parentPasswordHash');
    expect(student).not.toHaveProperty('parentPasswordSalt');
  });

  it('receipts from DocumentStore with status !== posted are not fetched (filter is applied)', async () => {
    // The reader only queries receipts with status == 'posted'
    // We verify the where clause is applied by ensuring .where was called with 'status', '==', 'posted'
    const receiptsWhereArgs: any[][] = [];
    const makeQuery = (docs: any[] = []) => {
      const q: any = {
        where: vi.fn((...args: any[]) => {
          receiptsWhereArgs.push(args);
          return q;
        }),
        orderBy: vi.fn(() => q),
        limit: vi.fn(() => q),
        limitToLast: vi.fn(() => q),
        startAfter: vi.fn(() => q),
        get: vi.fn().mockResolvedValue({ docs }),
      };
      return q;
    };

    const ledgerDoc = {
      id: 'ledger-1',
      data: () => ({ amount: 1000000, paidTotal: 0, studentId: 'stu-1' }),
    };
    const studentDoc = {
      exists: true,
      id: 'stu-1',
      data: () => ({ name: 'Test', studentId: 'HS001', classId: null, enrollmentStatus: 'active' }),
    };

    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(studentDoc) })),
          };
        }
        if (name === 'course_fee_ledgers') {
          return {
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ docs: [ledgerDoc] }),
              }),
            }),
          };
        }
        if (name === 'receipts') {
          return makeQuery([]);
        }
        return makeQuery();
      }),
      // The route id is resolved before anything is read; only the student
      // exists here, which is the ordinary case.
      doc: vi.fn((path: string) => ({
        get: vi
          .fn()
          .mockResolvedValue(
            path === 'students/stu-1' ? studentDoc : { exists: false, data: () => undefined }
          ),
      })),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    // Check receipts collection was queried with status == 'posted'
    const receiptsWhere = receiptsWhereArgs.find(
      (args) => args[0] === 'status' && args[1] === '==' && args[2] === 'posted'
    );
    expect(receiptsWhere).toBeDefined();
  });

  it('returns a timeline with a segment per course the student attended', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [
            {
              id: 'a1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2025-10-07',
              status: 'present',
            },
            {
              id: 'a2',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2026-06-02',
              status: 'absent',
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            grade: 3,
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            weeklySessions: [{ dayOfWeek: 2 }],
            terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const data = (res.body as any).data;
    expect(data.timeline.map((s: any) => s.term.termId)).toEqual(['term_1', 'current']);
    expect(data.timeline[0].attendanceMode).toBe('marked_only');
    expect(data.timeline[1].attendanceMode).toBe('expected');
    expect(data.timeline[0].className).toBe('Lớp 3B');
  });

  it('tags every attendance row with its termKey', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [
            {
              id: 'a1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2025-10-07',
              status: 'present',
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    const data = (res.body as any).data;
    const row = data.attendanceRows.find((r: any) => r.date === '2025-10-07');
    expect(row.termKey).toBe('class-1::term_1');
  });

  it('keeps termStart and termEnd on ledgers instead of dropping them', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [],
          course_fee_ledgers: [
            {
              id: 'led-1',
              studentId: 'stu-1',
              classId: 'class-1',
              amount: 1000000,
              paidTotal: 0,
              discountTotal: 0,
              termStart: '2025-09-01',
              termEnd: '2025-12-31',
            },
          ],
          receipts: [],
          class_sessions: [],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    const ledger = (res.body as any).data.ledgers[0];
    expect(ledger.termStart).toBe('2025-09-01');
    expect(ledger.termEnd).toBe('2025-12-31');
    expect(ledger.termKey).toBe('class-1::term_1');
  });

  it('does not resurface a voided row as unmarked in a marked_only course', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [
            {
              id: 'a1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2025-10-07',
              status: 'present',
              isVoided: true,
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    const data = (res.body as any).data;
    expect(data.attendanceRows.filter((r: any) => r.termKey === 'class-1::term_1')).toEqual([]);
  });

  it('does not synthesise an unmarked row from a makeup session in a marked_only course', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [
            {
              id: 'a1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2025-10-07',
              status: 'present',
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          // An extra makeup session inside the archived (no-snapshot) term:
          class_sessions: [{ id: 's1', classId: 'class-1', date: '2025-10-14', status: 'makeup' }],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    const rows = (res.body as any).data.attendanceRows.filter(
      (r: any) => r.termKey === 'class-1::term_1'
    );
    expect(rows.map((r: any) => [r.date, r.status])).toEqual([['2025-10-07', 'present']]);
  });

  it('keeps a real attendance row that falls on a cancelled date in a marked_only course', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [
            {
              id: 'a1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2025-10-07',
              status: 'present',
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          // The same date is marked cancelled — the real row must still win:
          class_sessions: [
            { id: 's1', classId: 'class-1', date: '2025-10-07', status: 'cancelled' },
          ],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    const rows = (res.body as any).data.attendanceRows.filter(
      (r: any) => r.termKey === 'class-1::term_1'
    );
    expect(rows.map((r: any) => [r.date, r.status])).toEqual([['2025-10-07', 'present']]);
  });

  it('ignores a makeup session from a course the student has no evidence for', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [
            {
              id: 'a1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2025-10-07',
              status: 'present',
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          // Makeup dated inside term_0 — a course this student never took
          // (no attendance, no ledger → no timeline segment):
          class_sessions: [{ id: 's1', classId: 'class-1', date: '2025-03-10', status: 'makeup' }],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            terms: [
              { id: 'term_0', startDate: '2025-01-01', endDate: '2025-04-30' },
              { id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' },
            ],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    const data = (res.body as any).data;
    expect(data.timeline.map((s: any) => s.term.termId)).not.toContain('term_0');
    expect(data.attendanceRows.filter((r: any) => r.termKey === 'class-1::term_0')).toEqual([]);
  });

  it('labels a real row on a makeup date with source makeup in a marked_only course', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [
            {
              id: 'a1',
              studentId: 'stu-1',
              classId: 'class-1',
              date: '2025-10-07',
              status: 'present',
            },
          ],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [{ id: 's1', classId: 'class-1', date: '2025-10-07', status: 'makeup' }],
        },
        {
          'class-1': {
            name: 'Lớp 3B',
            startDate: '2026-05-01',
            endDate: '2026-08-31',
            terms: [{ id: 'term_1', startDate: '2025-09-01', endDate: '2025-12-31' }],
          },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    const rows = (res.body as any).data.attendanceRows.filter(
      (r: any) => r.termKey === 'class-1::term_1'
    );
    expect(rows.map((r: any) => [r.date, r.status, r.source])).toEqual([
      ['2025-10-07', 'present', 'makeup'],
    ]);
  });

  it.each([
    [200, false],
    [201, true],
  ])('with %i ledgers sets truncation.ledgers to %s', async (count, flag) => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [],
          course_fee_ledgers: Array.from({ length: count }, (_, i) => ({
            id: `l${i}`,
            studentId: 'stu-1',
            classId: 'class-1',
            amount: 100,
            termStart: '2026-05-01',
            termEnd: '2026-08-31',
          })),
          receipts: [],
          class_sessions: [],
        },
        {
          'class-1': { name: 'Lớp 3B', startDate: '2026-05-01', endDate: '2026-08-31' },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    expect((res.body as any).data.truncation.ledgers).toBe(flag);
  });

  it.each([
    [5000, false],
    [5001, true],
  ])('with %i class session docs sets truncation.classSessions to %s', async (count, flag) => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: [],
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: Array.from({ length: count }, (_, i) => ({
            id: `s${i}`,
            classId: 'class-1',
            date: '2026-06-02',
            status: 'makeup',
          })),
        },
        {
          'class-1': { name: 'Lớp 3B', startDate: '2026-05-01', endDate: '2026-08-31' },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    expect((res.body as any).data.truncation.classSessions).toBe(flag);
  });

  it.each([
    [5000, false],
    [5001, true],
  ])('with %i attendance docs sets truncation.attendance to %s', async (count, flag) => {
    vi.mocked(getDb).mockReturnValue(
      makeStudentAdminDb(
        true,
        {
          attendance: Array.from({ length: count }, (_, i) => ({
            id: `a${i}`,
            studentId: 'stu-1',
            classId: 'class-1',
            date: '2026-06-02',
            status: 'present',
          })),
          course_fee_ledgers: [],
          receipts: [],
          class_sessions: [],
        },
        {
          'class-1': { name: 'Lớp 3B', startDate: '2026-05-01', endDate: '2026-08-31' },
        }
      ) as any
    );

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'student-admin-report', studentId: 'stu-1' } } as any,
      res
    );

    expect((res.body as any).data.truncation.attendance).toBe(flag);
  });

  it('no longer rejects ranges over 366 days', async () => {
    vi.mocked(getDb).mockReturnValue(makeStudentAdminDb() as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: {
          channel: 'student-admin-report',
          studentId: 'stu-1',
          from: '2020-01-01',
          to: '2026-12-31',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
  });
});

describe('read API teacher month salary visibility', () => {
  const seedMonthCollections = () => {
    const classesQuery = mockQuery([
      mockDoc('class-1', {
        name: '6A Global Success',
        teacherId: 'teacher-1',
        daysOfWeek: [1, 3],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        startTime: '17:30',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        status: 'active',
        holidays: [],
        salaryPerSession: 150000,
      }),
    ]);
    const sessionsQuery = mockQuery([
      mockDoc('class-1_2026-06-03', {
        classId: 'class-1',
        teacherId: 'teacher-1',
        date: '2026-06-03',
        status: 'taught',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 175000,
      }),
    ]);
    const usersQuery = mockQuery([
      mockDoc('teacher-1', {
        role: 'teacher',
        displayName: 'Teacher One',
        email: 'teacher@test.com',
      }),
    ]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesQuery;
        if (name === 'class_sessions') return sessionsQuery;
        if (name === 'users') return usersQuery;
        if (name === 'substitute_requests') return mockQuery([]);
        return mockQuery();
      }),
    } as any);
  };

  const readAs = async (role: string, channel: string, uid = `${role}-uid`) => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid,
      role,
      email: `${role}@test.com`,
      isBlocked: false,
    } as any);
    seedMonthCollections();

    const res = mockRes();
    await handler({ method: 'GET', query: { channel, month: '2026-06' } } as any, res);
    return res;
  };

  it('hides salary from office on office-teachers-month', async () => {
    const res = await readAs('office', 'office-teachers-month');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.classes[0]).not.toHaveProperty('salaryPerSession');
    expect(res.body.data.sessions[0]).not.toHaveProperty('salaryPerSession');
  });

  it('hides salary from office on teacher-payroll-month', async () => {
    const res = await readAs('office', 'teacher-payroll-month');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.classes[0]).not.toHaveProperty('salaryPerSession');
    expect(res.body.data.sessions[0]).not.toHaveProperty('salaryPerSession');
  });

  it('still returns the office rows it needs for the attendance export', async () => {
    const res = await readAs('office', 'teacher-payroll-month');

    expect(res.body.data.classes[0]).toMatchObject({ id: 'class-1', name: '6A Global Success' });
    expect(res.body.data.sessions[0]).toMatchObject({
      date: '2026-06-03',
      teacherAttendanceStatus: 'present',
    });
  });

  it('keeps salary for admin', async () => {
    const res = await readAs('admin', 'office-teachers-month');

    expect(res.body.data.classes[0].salaryPerSession).toBe(150000);
    expect(res.body.data.sessions[0].salaryPerSession).toBe(175000);
  });

  it('keeps salary for accounting', async () => {
    const res = await readAs('accounting', 'teacher-payroll-month');

    expect(res.body.data.classes[0].salaryPerSession).toBe(150000);
    expect(res.body.data.sessions[0].salaryPerSession).toBe(175000);
  });

  it('keeps salary for a teacher reading their own payroll', async () => {
    const res = await readAs('teacher', 'teacher-payroll-month', 'teacher-1');

    expect(res.body.data.classes[0].salaryPerSession).toBe(150000);
    expect(res.body.data.sessions[0].salaryPerSession).toBe(175000);
  });
});

describe('read API accounting students channel', () => {
  it('bounds accounting student ledger reads to the current page with a fixed cap', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);

    const studentsQuery: any = {
      where: vi.fn(() => studentsQuery),
      orderBy: vi.fn(() => studentsQuery),
      limit: vi.fn(() => studentsQuery),
      startAfter: vi.fn(() => studentsQuery),
      get: vi.fn().mockResolvedValue({
        docs: Array.from({ length: 30 }, (_, index) =>
          mockDoc(`student-${index + 1}`, { name: `Student ${index + 1}` })
        ),
      }),
    };
    const ledgersQuery: any = {
      where: vi.fn(() => ledgersQuery),
      limit: vi.fn(() => ledgersQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };
    const classesQuery = mockQuery([]);
    const teachersQuery = mockQuery([]);

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'students') return studentsQuery;
        if (name === 'course_fee_ledgers') return ledgersQuery;
        if (name === 'classes') return classesQuery;
        if (name === 'users') return teachersQuery;
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'GET', query: { channel: 'accounting-students', limit: '2000' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(studentsQuery.limit).toHaveBeenCalledWith(2001);
    expect(ledgersQuery.limit).toHaveBeenCalledWith(150);
    expect(ledgersQuery.limit).not.toHaveBeenCalledWith(10000);
  });
});

describe('read API accounting student finance channel', () => {
  it('serves student debt summaries through the public read channel', async () => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);

    const summaryQuery = mockQuery([
      mockDoc('student-1', {
        studentName: 'Nguyen Van A',
        studentNameNormalized: 'nguyen van a',
        studentCode: 'HS001',
        studentLifecycle: 'enrolled',
        currentClassId: 'class-1',
        currentEnrollmentId: 'enrollment-1',
        currentEnrollmentStatus: 'active',
        currentCoursePaymentStatus: 'partial',
        classCount: 1,
        courseCount: 1,
        totalPaid: 500000,
        totalOutstanding: 300000,
        overdueCourseCount: 0,
        priorityRank: 1,
        sourceVersion: 3,
        rebuiltAt: '2026-07-31T00:00:00.000Z',
      }),
    ]);
    // Version 3 is the canonical projection; a version-2 record now reads as
    // incomplete, which is the gate working.
    const healthDoc = mockExistingDoc('current', {
      sourceVersion: 3,
      complete: true,
      repairBacklog: 0,
      studentCount: 1,
      summaryCount: 1,
    });

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'accounting_student_summaries') return summaryQuery;
        if (name === 'accounting_student_summary_health') {
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(healthDoc) })),
          };
        }
        return mockQuery();
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'GET', query: { channel: 'accounting-student-finance' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      rows: [
        {
          studentId: 'student-1',
          studentName: 'Nguyen Van A',
          studentCode: 'HS001',
          totalPaid: 500000,
          totalOutstanding: 300000,
        },
      ],
      page: { nextCursor: null, hasMore: false },
      dataIncomplete: false,
    });
  });
});

describe('projectedClassDoc course closing flag', () => {
  const classDoc = (data: Record<string, unknown>) =>
    ({ id: 'class-1', data: () => ({ name: 'Toán 9A', ...data }) }) as any;

  it('exposes an approval that is still in force', () => {
    expect(
      projectedClassDoc(classDoc({ courseClosing: { approval: { status: 'approved' } } }))
    ).toMatchObject({ courseClosingApproved: true });
  });

  it('omits the flag for an invalidated or missing approval', () => {
    expect(
      projectedClassDoc(classDoc({ courseClosing: { approval: { status: 'invalidated' } } }))
    ).not.toHaveProperty('courseClosingApproved');
    expect(projectedClassDoc(classDoc({}))).not.toHaveProperty('courseClosingApproved');
  });
});
