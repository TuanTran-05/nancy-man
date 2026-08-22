import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWallet } from '../../server/api/finance/handlers/wallet.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({ getDb: vi.fn(() => testDb) }));
vi.mock('../../server/api/lib/documentStore/counterSequence.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../server/api/lib/documentStore/counterSequence.js')>();
  return {
    ...actual,
    reserveNextCounterSequence: vi.fn().mockResolvedValue(7),
  };
});
vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));
vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../server/api/lib/services/accountingStudentSummaryService.js', () => ({
  refreshAccountingStudentSummariesAfterCommit: vi.fn().mockResolvedValue(undefined),
}));
let testDb: any;

type DocStore = Map<string, Record<string, unknown>>;

function makeDb(seed: Record<string, Record<string, unknown>>): any {
  const docs: DocStore = new Map(Object.entries(seed));
  let autoId = 0;
  const ref = (col: string, id: string) => ({
    kind: 'doc',
    path: `${col}/${id}`,
    id,
    get: async () => snap(col, id),
  });
  const snap = (col: string, id: string) => ({
    exists: docs.has(`${col}/${id}`),
    id,
    data: () => docs.get(`${col}/${id}`),
    ref: ref(col, id),
  });
  const query = (
    col: string,
    filters: Array<{ field: string; op: string; value: unknown }> = []
  ): any => ({
    kind: 'query',
    col,
    filters,
    where: (field: string, op: string, value: unknown) =>
      query(col, [...filters, { field, op, value }]),
    get: async () => querySnap(col, filters),
  });
  const querySnap = (
    col: string,
    filters: Array<{ field: string; op: string; value: unknown }>
  ) => {
    const rows = [...docs.entries()]
      .filter(([key]) => key.startsWith(`${col}/`))
      .filter(([, data]) =>
        filters.every(({ field, op, value }) => {
          if (op === '==') return data[field] === value;
          if (op === '>') return Number(data[field] || 0) > Number(value);
          if (op === 'in') return Array.isArray(value) && value.includes(data[field]);
          return true;
        })
      )
      .map(([key, data]) => {
        const id = key.slice(col.length + 1);
        return { id, ref: ref(col, id), data: () => data };
      });
    return { docs: rows, size: rows.length, empty: rows.length === 0 };
  };
  const db = {
    docs,
    collection: (col: string) => ({
      doc: (id?: string) => ref(col, id || `auto-${++autoId}`),
      where: (field: string, op: string, value: unknown) => query(col).where(field, op, value),
      get: async () => querySnap(col, []),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (r: { kind?: string; path?: string; col?: string; filters?: any[] }) => {
          if (r.kind === 'query') return querySnap(String(r.col), r.filters || []);
          if (!r.path) throw new Error('Fake DocumentStore document read requires a path');
          const [col, id] = r.path.split('/');
          return snap(col, id);
        },
        set: (r: { path: string }, data: Record<string, unknown>) => {
          docs.set(r.path, data);
        },
        update: (r: { path: string }, data: Record<string, unknown>) => {
          docs.set(r.path, { ...(docs.get(r.path) || {}), ...data });
        },
      };
      return fn(tx);
    },
  };
  return db;
}

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => ((res.statusCode = code), res));
  res.json = vi.fn((body: unknown) => ((res.body = body), res));
  return res;
}

const userInfo = { role: 'accounting', name: 'Kế toán A' };

describe('handleWallet deposit-and-post', () => {
  beforeEach(() => {
    testDb = makeDb({ 'students/s1': { name: 'An', walletBalance: 100, classId: 'c1' } });
  });

  it('returns 410 because standalone wallet top-up is retired', async () => {
    const res = mockRes();
    await handleWallet(
      {
        method: 'POST',
        body: { idempotencyKey: 'k0', studentId: 's1', amountReceived: 500 },
        headers: {},
        query: {},
      } as any,
      res,
      '',
      'deposit-and-post',
      'uid-1',
      userInfo
    );
    expect(res.statusCode).toBe(410);
    expect(res.body).toMatchObject({ errorCode: 'wallet_top_up_retired' });
    expect(testDb.docs.get('students/s1').walletBalance).toBe(100);
    expect([...testDb.docs.keys()].some((path) => path.startsWith('receipts/'))).toBe(false);
  });
});

describe('handleWallet void', () => {
  beforeEach(() => {
    testDb = makeDb({
      'students/s1': { name: 'An', walletBalance: 200 },
      'wallet_transactions/w1': {
        studentId: 's1',
        type: 'deposit',
        status: 'posted',
        amount: 500,
        receiptId: 'r1',
      },
      'receipts/r1': { status: 'posted', receiptNo: 'PT-x' },
    });
  });

  it('rejects a void request with no idempotency key', async () => {
    const res = mockRes();
    await handleWallet(
      { method: 'POST', body: { reason: 'nhầm học sinh' }, headers: {}, query: {} } as any,
      res,
      'w1',
      'void',
      'uid-1',
      userInfo
    );
    expect(res.statusCode).toBe(400);
  });

  it('refuses when the wallet already spent the money', async () => {
    const res = mockRes();
    await handleWallet(
      {
        method: 'POST',
        body: { reason: 'nhầm học sinh', idempotencyKey: 'void-k1' },
        headers: {},
        query: {},
      } as any,
      res,
      'w1',
      'void',
      'uid-1',
      userInfo
    );
    expect(res.statusCode).toBe(400);
    expect(testDb.docs.get('students/s1').walletBalance).toBe(200);
  });

  it('returns 404 when the wallet transaction points at a missing student', async () => {
    testDb.docs.delete('students/s1');
    const res = mockRes();
    await handleWallet(
      {
        method: 'POST',
        body: { reason: 'nhầm học sinh', idempotencyKey: 'void-k404' },
        headers: {},
        query: {},
      } as any,
      res,
      'w1',
      'void',
      'uid-1',
      userInfo
    );
    expect(res.statusCode).toBe(404);
  });

  it('refuses a void key already used by another finance flow', async () => {
    testDb.docs.set('students/s1', { name: 'An', walletBalance: 700 });
    testDb.docs.set('finance_idempotency_keys/uid-1:shared', {
      type: 'wallet-deposit-and-post',
      response: { success: true, id: 'w-other' },
    });
    const res = mockRes();
    await handleWallet(
      {
        method: 'POST',
        body: { reason: 'nhầm học sinh', idempotencyKey: 'shared' },
        headers: {},
        query: {},
      } as any,
      res,
      'w1',
      'void',
      'uid-1',
      userInfo
    );
    expect(res.statusCode).toBe(409);
    expect(testDb.docs.get('wallet_transactions/w1').status).toBe('posted');
    expect(testDb.docs.get('students/s1').walletBalance).toBe(700);
  });

  it('voids deposit, receipt and balance together when funds allow', async () => {
    testDb.docs.set('students/s1', { name: 'An', walletBalance: 700 });
    const res = mockRes();
    await handleWallet(
      {
        method: 'POST',
        body: { reason: 'nhầm học sinh', idempotencyKey: 'void-k2' },
        headers: {},
        query: {},
      } as any,
      res,
      'w1',
      'void',
      'uid-1',
      userInfo
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.newBalance).toBe(200);
    expect(testDb.docs.get('wallet_transactions/w1').status).toBe('void');
    expect(testDb.docs.get('receipts/r1').status).toBe('void');
  });

  it('replays a duplicate void idempotency key without double-adjusting the balance', async () => {
    testDb.docs.set('students/s1', { name: 'An', walletBalance: 700 });
    const body = { reason: 'nhầm học sinh', idempotencyKey: 'void-k3' };
    const req = { method: 'POST', body, headers: {}, query: {} } as any;
    const res1 = mockRes();
    await handleWallet(req, res1, 'w1', 'void', 'uid-1', userInfo);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.newBalance).toBe(200);

    const res2 = mockRes();
    await handleWallet(req, res2, 'w1', 'void', 'uid-1', userInfo);
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual(res1.body);
    expect(testDb.docs.get('students/s1').walletBalance).toBe(200);
  });
});

describe('handleWallet reads', () => {
  it('lists only v2 history rows with opening and running balances', async () => {
    testDb = makeDb({
      'students/s1': {
        name: 'An',
        walletBalance: 300,
        walletHistoryStartedAt: '2026-07-27T00:00:00.000Z',
        walletOpeningBalance: 100,
      },
      'wallet_transactions/old': {
        studentId: 's1',
        type: 'deposit',
        status: 'posted',
        amount: 9_000,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      'wallet_transactions/w1': {
        studentId: 's1',
        schemaVersion: 2,
        transactionGroupId: 'g1',
        groupSequence: 0,
        source: 'manual_receipt',
        type: 'deposit',
        status: 'posted',
        amount: 500,
        createdAt: '2026-07-28T00:00:00.000Z',
      },
      'wallet_transactions/w2': {
        studentId: 's1',
        schemaVersion: 2,
        transactionGroupId: 'g1',
        groupSequence: 1,
        source: 'manual_receipt',
        type: 'allocation',
        status: 'posted',
        amount: 300,
        createdAt: '2026-07-28T00:00:00.000Z',
      },
      'wallet_transactions/other': {
        studentId: 's2',
        type: 'deposit',
        status: 'posted',
        amount: 999,
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    });
    const res = mockRes();
    await handleWallet(
      { method: 'GET', query: { studentId: 's1' }, headers: {} } as any,
      res,
      '',
      'transactions',
      'uid-1',
      userInfo
    );
    expect(res.body.walletBalance).toBe(300);
    expect(res.body.opening).toEqual({
      startedAt: '2026-07-27T00:00:00.000Z',
      balance: 100,
    });
    expect(res.body.transactions.map((row: any) => row.id)).toEqual(['w2', 'w1']);
  });

  it('labels a closed class that accounting cannot read from the class list', async () => {
    testDb = makeDb({
      'students/s1': { name: 'An', classId: 'closed', walletBalance: 70 },
      'classes/closed': { name: 'G6', status: 'archived' },
    });
    const res = mockRes();
    await handleWallet(
      { method: 'GET', query: {}, headers: {} } as any,
      res,
      '',
      'balances',
      'uid-1',
      userInfo
    );
    expect(res.body.students[0]).toMatchObject({
      id: 's1',
      classId: 'closed',
      className: 'G6',
      classStatus: 'archived',
    });
  });

  it('lists all students including zero balances with finance identity fields', async () => {
    testDb = makeDb({
      'students/s1': {
        name: 'An',
        code: 'HS1',
        dob: '2015-05-10',
        classId: 'c1',
        contact: '0901000001',
        studentLifecycle: 'enrolled',
        walletBalance: 70,
      },
      'students/s2': {
        name: 'Bình',
        code: 'HS2',
        dob: '2014-04-09',
        classId: 'c2',
        contact: '0901000002',
        studentLifecycle: 'archived',
        isRevoked: true,
        walletBalance: 0,
      },
    });
    const res = mockRes();
    await handleWallet(
      { method: 'GET', query: {}, headers: {} } as any,
      res,
      '',
      'balances',
      'uid-1',
      userInfo
    );
    expect(res.body.students).toEqual([
      expect.objectContaining({
        id: 's1',
        name: 'An',
        code: 'HS1',
        dob: '2015-05-10',
        classId: 'c1',
        contact: '0901000001',
        studentLifecycle: 'enrolled',
        walletBalance: 70,
      }),
      expect.objectContaining({
        id: 's2',
        name: 'Bình',
        code: 'HS2',
        walletBalance: 0,
        isRevoked: true,
      }),
    ]);
  });

  it('returns only the selected student unpaid and partial ledgers in context', async () => {
    testDb = makeDb({
      'students/s1': { name: 'An', walletBalance: 500 },
      'course_fee_ledgers/l1': {
        studentId: 's1',
        classId: 'c1',
        amount: 1_000,
        paidTotal: 100,
        discountTotal: 0,
        status: 'partial',
      },
      'course_fee_ledgers/paid': {
        studentId: 's1',
        classId: 'c2',
        amount: 1_000,
        paidTotal: 1_000,
        discountTotal: 0,
        status: 'paid',
      },
      'course_fee_ledgers/other': {
        studentId: 's2',
        classId: 'c3',
        amount: 1_000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
      },
      'classes/c1': { name: 'G6', status: 'archived' },
    });
    const res = mockRes();
    await handleWallet(
      { method: 'GET', query: { studentId: 's1' }, headers: {} } as any,
      res,
      '',
      'student-context',
      'uid-1',
      userInfo
    );
    expect(res.body).toMatchObject({ studentId: 's1', walletBalance: 500 });
    expect(res.body.ledgers.map((ledger: any) => ledger.id)).toEqual(['l1']);
    // Closed classes are unreadable for accounting, so the label ships with the row.
    expect(res.body.ledgers[0].className).toBe('G6');
  });
});

describe('handleWallet standalone allocation', () => {
  beforeEach(() => {
    testDb = makeDb({
      'students/s1': { name: 'An', walletBalance: 1_000 },
      'course_fee_ledgers/l1': {
        studentId: 's1',
        classId: 'c1',
        amount: 1_000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
      },
      'course_fee_ledgers/l2': {
        studentId: 's1',
        classId: 'c2',
        amount: 2_000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
      },
    });
  });

  it('allocates two ledgers atomically and replays without double spending', async () => {
    const body = {
      idempotencyKey: 'allocation-key',
      studentId: 's1',
      allocations: [
        { ledgerId: 'l1', amount: 400 },
        { ledgerId: 'l2', amount: 300 },
      ],
    };
    const request = { method: 'POST', body, headers: {}, query: {} } as any;
    const first = mockRes();
    await handleWallet(request, first, '', 'allocate-and-post', 'uid-1', userInfo);
    const second = mockRes();
    await handleWallet(request, second, '', 'allocate-and-post', 'uid-1', userInfo);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(testDb.docs.get('students/s1')?.walletBalance).toBe(300);
    expect(testDb.docs.get('course_fee_ledgers/l1')?.paidTotal).toBe(400);
    expect(testDb.docs.get('course_fee_ledgers/l2')?.paidTotal).toBe(300);
    expect(
      [...testDb.docs.values()].filter((row) => row.source === 'manual_allocation')
    ).toHaveLength(2);
  });

  it('voids the whole allocation group once when given one member row', async () => {
    const createRes = mockRes();
    await handleWallet(
      {
        method: 'POST',
        body: {
          idempotencyKey: 'allocation-key',
          studentId: 's1',
          allocations: [
            { ledgerId: 'l1', amount: 400 },
            { ledgerId: 'l2', amount: 300 },
          ],
        },
        headers: {},
        query: {},
      } as any,
      createRes,
      '',
      'allocate-and-post',
      'uid-1',
      userInfo
    );
    const memberPath = [...testDb.docs.entries()].find(
      ([, row]) => row.source === 'manual_allocation'
    )![0];
    const memberId = memberPath.split('/')[1];
    const body = { idempotencyKey: 'allocation-void-key', reason: 'Cấn nhầm' };
    const first = mockRes();
    await handleWallet(
      { method: 'POST', body, headers: {}, query: {} } as any,
      first,
      memberId,
      'void',
      'uid-1',
      userInfo
    );
    const second = mockRes();
    await handleWallet(
      { method: 'POST', body, headers: {}, query: {} } as any,
      second,
      memberId,
      'void',
      'uid-1',
      userInfo
    );

    expect(first.body.newBalance).toBe(1_000);
    expect(second.body).toEqual(first.body);
    expect(testDb.docs.get('course_fee_ledgers/l1')?.paidTotal).toBe(0);
    expect(testDb.docs.get('course_fee_ledgers/l2')?.paidTotal).toBe(0);
    expect(
      [...testDb.docs.values()]
        .filter((row) => row.source === 'manual_allocation')
        .every((row) => row.status === 'void')
    ).toBe(true);
  });

  it.each([
    ['manual_receipt', 'wallet_void_via_receipt'],
    ['student_refund', 'wallet_void_via_expense'],
  ])('rejects wallet-level void for %s rows', async (source, errorCode) => {
    testDb.docs.set('wallet_transactions/foreign', {
      schemaVersion: 2,
      transactionGroupId: 'foreign-group',
      groupSequence: 0,
      source,
      studentId: 's1',
      ledgerId: 'l1',
      type: source === 'student_refund' ? 'refund' : 'allocation',
      status: 'posted',
      amount: 100,
    });
    const res = mockRes();
    await handleWallet(
      {
        method: 'POST',
        body: { idempotencyKey: `void-${source}`, reason: 'Sai luồng' },
        headers: {},
        query: {},
      } as any,
      res,
      'foreign',
      'void',
      'uid-1',
      userInfo
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe(errorCode);
  });
});
