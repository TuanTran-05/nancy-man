import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/finance/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { getUserRoleAndName } from '../../server/api/lib/http/helpers.js';
import { voidWalletManualReceipt } from '../../server/api/finance/handlers/manualReceiptWallet.js';
import { handleExpenses } from '../../server/api/finance/handlers/expenses.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/http/helpers.js', () => ({
  getUserRoleAndName: vi.fn().mockResolvedValue({ role: 'admin', name: 'Admin' }),
  normalizeBody: vi.fn((b: any) => b || {}),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 60, resetAt: Date.now() }),
}));

vi.mock('../../server/api/lib/payments/tuitionPayments.js', () => ({
  formatDateForZalo: vi.fn((value: string) => value),
  sendServerPaymentConfirmation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/jobs/outbox.js', () => ({
  createOutboxJob: vi.fn().mockResolvedValue('job-1'),
}));

vi.mock('../../server/api/finance/handlers/manualReceiptWallet.js', () => ({
  postWalletManualReceipt: vi.fn(),
  voidWalletManualReceipt: vi.fn(),
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
  res.end = vi.fn();
  return res;
}

function mockFinanceDb(options: {
  counterExists: boolean;
  counterSeq?: number;
  lastNumber?: string;
}) {
  const query: any = {};
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.get = vi.fn(async () =>
    options.lastNumber
      ? {
          empty: false,
          docs: [
            { data: () => ({ expenseNo: options.lastNumber, receiptNo: options.lastNumber }) },
          ],
        }
      : { empty: true, docs: [] }
  );
  const counterRef = (id: string) => ({
    id,
    path: `_counters/${id}`,
    get: vi.fn().mockResolvedValue({
      exists: options.counterExists,
      data: () => ({ seq: options.counterSeq || 0 }),
    }),
  });

  const tx = {
    get: vi.fn(async (target: any) => {
      if (target.path?.startsWith('_counters/')) {
        return {
          exists: options.counterExists,
          data: () => ({ seq: options.counterSeq || 0 }),
        };
      }

      return options.lastNumber
        ? { empty: false, docs: [{ data: () => ({ expenseNo: options.lastNumber }) }] }
        : { empty: true, docs: [] };
    }),
    update: vi.fn(),
    create: vi.fn(),
  };

  const db = {
    collection: vi.fn((name: string) => {
      if (name === '_counters') {
        return {
          doc: vi.fn(counterRef),
        };
      }
      return query;
    }),
    runTransaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<number>) =>
      callback(tx)
    ),
  };

  return { db, tx };
}

function mockExpenseCreateDb() {
  let seq = 0;
  let nextDocId = 1;
  const createdExpenses: any[] = [];
  const idempotencyDocs = new Map<string, any>();

  const makeRef = (collectionName: string, id: string) => ({
    id,
    path: `${collectionName}/${id}`,
  });

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'expenses') {
        return {
          add: vi.fn(async (data: any) => {
            const ref = makeRef('expenses', `legacy-expense-${nextDocId++}`);
            createdExpenses.push({ id: ref.id, ...data });
            return ref;
          }),
          doc: vi.fn(() => makeRef('expenses', `expense-${nextDocId++}`)),
        };
      }
      if (name === 'counters') {
        return {
          doc: vi.fn((id: string) => makeRef('counters', id)),
        };
      }
      if (name === 'expense_numbers') {
        return {
          doc: vi.fn((id: string) => makeRef('expense_numbers', id)),
        };
      }
      if (name === 'finance_idempotency_keys') {
        return {
          doc: vi.fn((id: string) => makeRef('finance_idempotency_keys', id)),
        };
      }
      return {};
    }),
    runTransaction: vi.fn(async (callback: any) => {
      const tx = {
        get: vi.fn(async (target: any) => {
          if (String(target.path || '').startsWith('finance_idempotency_keys/')) {
            const data = idempotencyDocs.get(target.path);
            return {
              exists: !!data,
              data: () => data || {},
            };
          }
          if (String(target.path || '').startsWith('counters/expenses_')) {
            return {
              exists: seq > 0,
              data: () => ({ seq }),
            };
          }
          if (String(target.path || '').startsWith('expense_numbers/')) {
            return { exists: false, data: () => ({}) };
          }
          return { exists: false, data: () => ({}) };
        }),
        set: vi.fn((target: any, data: any) => {
          if (String(target.path || '').startsWith('finance_idempotency_keys/')) {
            idempotencyDocs.set(target.path, data);
          }
          if (String(target.path || '').startsWith('counters/expenses_')) {
            seq = Number(data.seq || 0);
          }
          if (String(target.path || '').startsWith('expenses/')) {
            createdExpenses.push({ id: target.id, ...data });
          }
        }),
      };
      return callback(tx);
    }),
  };

  return { db, createdExpenses };
}

function makeExpenseWalletDb(seed: Record<string, Record<string, unknown>>) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed));
  let autoId = 0;
  const ref = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
  });
  const snap = (path: string) => ({
    exists: docs.has(path),
    id: path.split('/').pop(),
    data: () => docs.get(path),
  });
  const db = {
    docs,
    collection(name: string) {
      return {
        doc(id?: string) {
          return ref(name, id || `auto-${++autoId}`);
        },
      };
    },
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        get: async (target: { path: string }) => snap(target.path),
        set: (target: { path: string }, data: Record<string, unknown>) => {
          docs.set(target.path, data);
        },
        update: (target: { path: string }, data: Record<string, unknown>) => {
          docs.set(target.path, { ...(docs.get(target.path) || {}), ...data });
        },
      };
      return callback(tx);
    },
  };
  return db;
}

function mockReceiptCreateAndPostDb() {
  const idempotencyDocs = new Map<string, any>();
  const createdReceipts: any[] = [];
  const receiptRef = { id: 'receipt-1', path: 'receipts/receipt-1' };
  const ledgerRef = { id: 'ledger-1', path: 'course_fee_ledgers/ledger-1' };
  const idempotencyRef = {
    id: 'admin-uid:receipt-submit-1',
    path: 'finance_idempotency_keys/admin-uid:receipt-submit-1',
  };
  const activePaymentsQuery: any = { path: 'payment_requests_query' };
  activePaymentsQuery.where = vi.fn(() => activePaymentsQuery);
  const receiptNumberQuery: any = { path: 'receipt_number_query' };
  receiptNumberQuery.where = vi.fn(() => receiptNumberQuery);
  receiptNumberQuery.orderBy = vi.fn(() => receiptNumberQuery);
  receiptNumberQuery.limit = vi.fn(() => receiptNumberQuery);

  const db: any = {
    collection: vi.fn((name: string) => {
      if (name === '_counters') {
        return { doc: vi.fn((id: string) => ({ id, path: `_counters/${id}` })) };
      }
      if (name === 'finance_idempotency_keys') return { doc: vi.fn(() => idempotencyRef) };
      if (name === 'receipts') {
        return {
          doc: vi.fn(() => receiptRef),
          where: vi.fn(() => receiptNumberQuery),
        };
      }
      if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
      if (name === 'payment_requests') return { where: vi.fn(() => activePaymentsQuery) };
      if (name === 'students') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(makeDoc({ name: 'Student A', studentId: 'HS001' })),
          })),
        };
      }
      if (name === 'classes') {
        return {
          doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({ name: 'Class A' })) })),
        };
      }
      return {};
    }),
    runTransaction: vi.fn(async (callback: any) => {
      const tx = {
        get: vi.fn(async (target: any) => {
          if (String(target.path || '').startsWith('_counters/')) {
            return { exists: false, data: () => ({}) };
          }
          if (target === receiptNumberQuery) return { empty: true, docs: [] };
          if (target === idempotencyRef) {
            const data = idempotencyDocs.get(target.path);
            return { exists: !!data, data: () => data || {} };
          }
          if (target === ledgerRef) {
            return makeDoc({
              studentId: 'stu-1',
              classId: 'class-1',
              amount: 5000,
              paidTotal: 1000,
              discountTotal: 0,
            });
          }
          if (target === activePaymentsQuery) return { empty: true, size: 0, docs: [] };
          return makeDoc({}, false);
        }),
        create: vi.fn(),
        update: vi.fn(),
        set: vi.fn((target: any, data: any) => {
          if (target === receiptRef) createdReceipts.push({ id: target.id, ...data });
          if (target === idempotencyRef) idempotencyDocs.set(target.path, data);
        }),
      };
      return callback(tx);
    }),
  };

  return { db, createdReceipts };
}

function mockReceiptDraftCreateDb() {
  const receiptRef = { id: 'receipt-1', path: 'receipts/receipt-1' };
  const ledgerRef = {
    id: 'ledger-1',
    path: 'course_fee_ledgers/ledger-1',
    get: vi.fn().mockResolvedValue(
      makeDoc({
        studentId: 'stu-1',
        classId: 'class-1',
        amount: 5000,
        paidTotal: 1000,
        discountTotal: 0,
      })
    ),
  };
  const receiptNumberQuery: any = { path: 'receipt_number_query' };
  receiptNumberQuery.where = vi.fn(() => receiptNumberQuery);
  receiptNumberQuery.orderBy = vi.fn(() => receiptNumberQuery);
  receiptNumberQuery.limit = vi.fn(() => receiptNumberQuery);
  const receiptsAdd = vi.fn(async () => receiptRef);

  const tx = {
    get: vi.fn(async (target: any) => {
      if (String(target.path || '').startsWith('_counters/')) {
        return { exists: false, data: () => ({}) };
      }
      if (target === receiptNumberQuery) return { empty: true, docs: [] };
      if (target === ledgerRef) return await ledgerRef.get();
      return makeDoc({}, false);
    }),
    create: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  };

  const db: any = {
    collection: vi.fn((name: string) => {
      if (name === '_counters') {
        return { doc: vi.fn((id: string) => ({ id, path: `_counters/${id}` })) };
      }
      if (name === 'receipts') {
        return {
          doc: vi.fn(() => receiptRef),
          add: receiptsAdd,
          where: vi.fn(() => receiptNumberQuery),
        };
      }
      if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
      if (name === 'students') {
        return { doc: vi.fn(() => ({ path: 'students/stu-1' })) };
      }
      return {};
    }),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };

  return { db, tx, receiptRef, receiptsAdd };
}

function makeDoc(data: any, exists = true) {
  return {
    exists,
    data: () => data,
  };
}

describe('GET /api/v1/finance/:resource/next-number', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T03:00:00.000Z'));
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid', role: 'admin' } as any);
    vi.mocked(verifyAuthContext).mockImplementation(async (req, res, requiredRoles) => {
      const decoded = await verifyAuthToken(req, res, requiredRoles);
      if (!decoded) return null;
      const userInfo = await getUserRoleAndName(null as any, decoded.uid, decoded.email).catch(
        () => ({ role: 'admin', name: 'Admin' })
      );
      return {
        decoded,
        context: {
          uid: decoded.uid,
          email: decoded.email,
          role: userInfo.role as any,
          name: userInfo.name || 'Admin',
        },
      } as any;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A write to an action nobody has classified. Known read-only reporting
  // actions are registered under every method precisely so their own 405 keeps
  // working; this covers the genuinely unlisted case.
  it('fails closed before dispatch when a write hits an action missing from the inventory', async () => {
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'not-a-registered-finance-action' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      code: 'STUDENT_IDENTITY_MUTATION_UNCLASSIFIED',
    });
    expect(verifyAuthContext).not.toHaveBeenCalled();
  });

  it('previews receipt numbers without reserving counters', async () => {
    const { db, tx } = mockFinanceDb({ counterExists: true, counterSeq: 7 });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { resource: 'receipts', action: 'next-number' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      receiptNo: 'PT-260513-008',
      preview: true,
      reserved: false,
    });
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('previews expense numbers without reserving counters', async () => {
    const { db, tx } = mockFinanceDb({ counterExists: false, lastNumber: 'PC-260513-009' });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { resource: 'expenses', action: 'next-number' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      expenseNo: 'PC-260513-010',
      preview: true,
      reserved: false,
    });
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('uses verified auth context for finance requests without getUserRoleAndName', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'accounting-uid', email: 'acct@example.com' } as any,
      context: {
        uid: 'accounting-uid',
        email: 'acct@example.com',
        role: 'accounting',
        name: 'Accounting User',
      },
    });
    vi.mocked(getUserRoleAndName).mockClear();

    const { db } = mockFinanceDb({ counterExists: true, counterSeq: 7 });
    vi.mocked(getDb).mockReturnValue(db as any);
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        query: { resource: 'expenses', action: 'next-number' },
        headers: { authorization: 'Bearer token' },
      } as any,
      res as any
    );

    expect(verifyAuthContext).toHaveBeenCalledWith(expect.anything(), res, [
      'admin',
      'accounting',
      'teacher',
    ]);
    expect(getUserRoleAndName).not.toHaveBeenCalled();
  });

  it('posts a manual receipt and sends the Zalo payment confirmation server-side', async () => {
    const receiptRef = { id: 'receipt-1' };
    const ledgerRef = { id: 'ledger-1' };
    const activePaymentRef = { id: 'payment-1' };
    const activePaymentsQuery: any = {};
    activePaymentsQuery.where = vi.fn(() => activePaymentsQuery);
    activePaymentsQuery.get = vi
      .fn()
      .mockResolvedValue({ empty: false, docs: [{ ref: activePaymentRef }] });
    const receipt = {
      receiptNo: 'PT-260513-001',
      status: 'draft',
      ledgerId: 'ledger-1',
      studentId: 'stu-1',
      classId: 'class-1',
      amountReceived: 2000,
      receivedDate: '2026-05-13',
      discountAmount: 0,
    };
    const ledger = { amount: 5000, paidTotal: 1000, discountTotal: 0 };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === receiptRef) return makeDoc(receipt);
        if (target === ledgerRef) return makeDoc(ledger);
        if (target === activePaymentsQuery) {
          return { empty: false, docs: [{ ref: activePaymentRef }] };
        }
        return makeDoc({}, false);
      }),
      update: vi.fn(),
      create: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'payment_requests') {
          return {
            where: vi.fn(() => activePaymentsQuery),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  makeDoc({ name: 'Student A', studentId: 'HS001', contact: '0384072314' })
                ),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  makeDoc({ name: 'Class A', startDate: '2026-01-01', endDate: '2026-06-01' })
                ),
            })),
          };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'post', id: 'receipt-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      newPaidTotal: 3000,
      newLedgerStatus: 'partial',
    });
    expect(tx.update).toHaveBeenCalledWith(
      receiptRef,
      expect.objectContaining({ status: 'posted' })
    );
    expect(tx.get).toHaveBeenCalledWith(activePaymentsQuery);
    expect(activePaymentsQuery.get).not.toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledWith(
      activePaymentRef,
      expect.objectContaining({
        status: 'stale',
        staleReason: 'manual_receipt_posted',
        accountingResolution: 'manual_receipt_posted_while_gateway_session_active',
        manualReceiptId: 'receipt-1',
        manualReceiptNo: 'PT-260513-001',
        manualReceiptAmount: 2000,
        manualReceiptPostedBy: 'admin-uid',
      })
    );
    const { createOutboxJob } = await import('../../server/api/lib/jobs/outbox.js');
    expect(createOutboxJob).not.toHaveBeenCalled();
  });

  it('does not enqueue a receipt payment confirmation while the feature is disabled', async () => {
    const { createOutboxJob } = await import('../../server/api/lib/jobs/outbox.js');
    const receiptRef = { id: 'receipt-1' };
    const ledgerRef = { id: 'ledger-1' };
    const activePaymentsQuery: any = {
      where: vi.fn(() => activePaymentsQuery),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const receipt = {
      id: 'receipt-1',
      receiptNo: 'PT-260513-001',
      status: 'draft',
      ledgerId: 'ledger-1',
      studentId: 'stu-1',
      classId: 'class-1',
      amountReceived: 2000,
      receivedDate: '2026-05-13',
      discountAmount: 0,
    };
    const ledger = { amount: 5000, paidTotal: 1000, discountTotal: 0 };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === receiptRef) return makeDoc(receipt);
        if (target === ledgerRef) return makeDoc(ledger);
        if (target === activePaymentsQuery) return { empty: true, docs: [] };
        return makeDoc({}, false);
      }),
      update: vi.fn(),
      create: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'payment_requests') return { where: vi.fn(() => activePaymentsQuery) };
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  makeDoc({ name: 'Student A', studentId: 'HS001', contact: '0384072314' })
                ),
            })),
          };
        }
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue(
                  makeDoc({ name: 'Class A', startDate: '2026-01-01', endDate: '2026-06-01' })
                ),
            })),
          };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'post', id: 'receipt-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(createOutboxJob).not.toHaveBeenCalled();
  });

  it('create-and-post is idempotent for repeated receipt submissions', async () => {
    const { db, createdReceipts } = mockReceiptCreateAndPostDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const body = {
      idempotencyKey: 'receipt-submit-1',
      studentId: 'stu-1',
      classId: 'class-1',
      ledgerId: 'ledger-1',
      amountReceived: 2000,
      paymentMethod: 'cash',
      receivedDate: '2026-05-13',
      discountType: 'none',
    };

    const firstRes = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'create-and-post' },
        body,
      } as any,
      firstRes
    );

    const secondRes = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'create-and-post' },
        body,
      } as any,
      secondRes
    );

    expect(firstRes.statusCode).toBe(201);
    expect(secondRes.statusCode).toBe(200);
    expect(firstRes.body).toMatchObject({
      success: true,
      id: 'receipt-1',
      status: 'posted',
      newPaidTotal: 3000,
    });
    expect(secondRes.body).toMatchObject(firstRes.body);
    expect(createdReceipts).toHaveLength(1);
    expect(createdReceipts[0]).toMatchObject({ status: 'posted', amountReceived: 2000 });
  });

  it('creates draft receipts in the same transaction that reserves the receipt number', async () => {
    const { db, tx, receiptRef, receiptsAdd } = mockReceiptDraftCreateDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'create' },
        body: {
          studentId: 'stu-1',
          classId: 'class-1',
          ledgerId: 'ledger-1',
          amountReceived: 2000,
          paymentMethod: 'cash',
          receivedDate: '2026-05-13',
          discountType: 'none',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(receiptsAdd).not.toHaveBeenCalled();
    expect(tx.set).toHaveBeenCalledWith(
      receiptRef,
      expect.objectContaining({
        receiptNo: 'PT-260513-001',
        status: 'draft',
        amountReceived: 2000,
      })
    );
  });

  it('rejects a stale sibling entitlement claim with 409', async () => {
    const receiptRef = { id: 'receipt-1', path: 'receipts/receipt-1' };
    const ledgerRef = { id: 'ledger-1', path: 'course_fee_ledgers/ledger-1' };
    const idempotencyRef = {
      id: 'admin-uid:sibling-stale-1',
      path: 'finance_idempotency_keys/admin-uid:sibling-stale-1',
    };
    const studentRef = { id: 'stu-1', path: 'students/stu-1' };
    const siblingGroupQuery: any = { path: 'students_sibling_group_query' };
    siblingGroupQuery.where = vi.fn(() => siblingGroupQuery);
    const activePaymentsQuery: any = { path: 'payment_requests_query' };
    activePaymentsQuery.where = vi.fn(() => activePaymentsQuery);

    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'finance_idempotency_keys') return { doc: vi.fn(() => idempotencyRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'payment_requests') return { where: vi.fn(() => activePaymentsQuery) };
        if (name === 'students') {
          return {
            doc: vi.fn(() => studentRef),
            where: vi.fn(() => siblingGroupQuery),
          };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => {
        const tx = {
          get: vi.fn(async (target: any) => {
            if (target === idempotencyRef) return { exists: false, data: () => ({}) };
            if (target === ledgerRef) {
              return makeDoc({
                studentId: 'stu-1',
                classId: 'class-1',
                amount: 1_000_000,
                paidTotal: 0,
                discountTotal: 100_000,
                siblingDiscountTotal: 100_000,
              });
            }
            if (target === studentRef) {
              return makeDoc({ siblingGroupId: 'g1', studentLifecycle: 'enrolled' });
            }
            if (target === siblingGroupQuery) {
              return {
                docs: [
                  {
                    id: 'stu-1',
                    data: () => ({ siblingGroupId: 'g1', studentLifecycle: 'enrolled' }),
                  },
                  {
                    id: 'stu-2',
                    data: () => ({ siblingGroupId: 'g1', studentLifecycle: 'enrolled' }),
                  },
                ],
              };
            }
            if (target === activePaymentsQuery) return { empty: true, size: 0, docs: [] };
            return makeDoc({}, false);
          }),
          set: vi.fn(),
          update: vi.fn(),
          create: vi.fn(),
        };
        return callback(tx);
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'create-and-post' },
        body: {
          idempotencyKey: 'sibling-stale-1',
          studentId: 'stu-1',
          classId: 'class-1',
          ledgerId: 'ledger-1',
          amountReceived: 900_000,
          paymentMethod: 'cash',
          receivedDate: '2026-05-13',
          discountType: 'none',
          siblingDiscount: true,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'stale_sibling_entitlement',
      error: expect.stringContaining('already granted'),
    });
  });

  function buildSiblingPostDb(options: {
    ledger: Record<string, unknown>;
    receipt: Record<string, unknown>;
    studentData: Record<string, unknown>;
    siblingGroupDocs: Array<{ id: string; data: Record<string, unknown> }>;
    getsAfterFirstWriteThrow?: boolean;
  }) {
    const receiptRef = { id: 'receipt-1', path: 'receipts/receipt-1' };
    const ledgerRef = { id: 'ledger-1', path: 'course_fee_ledgers/ledger-1' };
    const studentRef = { id: 'stu-1', path: 'students/stu-1' };
    const siblingGroupQuery: any = { path: 'students_sibling_group_query' };
    siblingGroupQuery.where = vi.fn(() => siblingGroupQuery);
    const activePaymentsQuery: any = { path: 'payment_requests_query' };
    activePaymentsQuery.where = vi.fn(() => activePaymentsQuery);

    let wroteOnce = false;
    const tx: any = {
      get: vi.fn(async (target: any) => {
        if (options.getsAfterFirstWriteThrow && wroteOnce) {
          throw new Error('DocumentStore read after write is not allowed');
        }
        if (target === receiptRef) return makeDoc(options.receipt);
        if (target === ledgerRef) return makeDoc(options.ledger);
        if (target === studentRef) return makeDoc(options.studentData);
        if (target === siblingGroupQuery) {
          return { docs: options.siblingGroupDocs.map((d) => ({ id: d.id, data: () => d.data })) };
        }
        if (target === activePaymentsQuery) return { empty: true, size: 0, docs: [] };
        return makeDoc({}, false);
      }),
      update: vi.fn(() => {
        wroteOnce = true;
      }),
      set: vi.fn(() => {
        wroteOnce = true;
      }),
      create: vi.fn(() => {
        wroteOnce = true;
      }),
    };

    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'payment_requests') return { where: vi.fn(() => activePaymentsQuery) };
        if (name === 'students') {
          return { doc: vi.fn(() => studentRef), where: vi.fn(() => siblingGroupQuery) };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };

    return { db, tx, receiptRef, ledgerRef };
  }

  it('increments both discountTotal and siblingDiscountTotal on post', async () => {
    const { db, tx, ledgerRef } = buildSiblingPostDb({
      ledger: { amount: 1_000_000, paidTotal: 0, discountTotal: 0, siblingDiscountTotal: 0 },
      receipt: {
        status: 'draft',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        amountReceived: 800_000,
        discountAmount: 200_000,
        siblingDiscountAmount: 100_000,
        siblingDiscount: true,
      },
      studentData: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' },
      siblingGroupDocs: [
        { id: 'stu-1', data: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' } },
        { id: 'stu-2', data: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' } },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'post', id: 'receipt-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      ledgerRef,
      expect.objectContaining({ discountTotal: 200_000, siblingDiscountTotal: 100_000 })
    );
  });

  it('clamps a stale draft on post and strips the sibling fields from the receipt', async () => {
    const { db, tx, receiptRef } = buildSiblingPostDb({
      ledger: {
        amount: 1_000_000,
        paidTotal: 0,
        discountTotal: 100_000,
        siblingDiscountTotal: 100_000,
      },
      receipt: {
        status: 'draft',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        amountReceived: 800_000,
        discountAmount: 200_000,
        siblingDiscountAmount: 100_000,
        siblingDiscount: true,
      },
      studentData: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' },
      siblingGroupDocs: [
        { id: 'stu-1', data: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' } },
        { id: 'stu-2', data: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' } },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'post', id: 'receipt-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const receiptUpdateCall = tx.update.mock.calls.find((call: any[]) => call[0] === receiptRef);
    expect(receiptUpdateCall[1]).toMatchObject({ status: 'posted', discountAmount: 100_000 });
    expect(receiptUpdateCall[1]).toHaveProperty('siblingDiscountAmount');
    expect(receiptUpdateCall[1]).toHaveProperty('siblingDiscount');
    expect(receiptUpdateCall[1].siblingDiscountAmount).not.toBe(100_000);
  });

  it('removes the sibling component on post after a lifecycle change makes the student ineligible', async () => {
    const { db, tx, receiptRef, ledgerRef } = buildSiblingPostDb({
      ledger: { amount: 1_000_000, paidTotal: 0, discountTotal: 0, siblingDiscountTotal: 0 },
      receipt: {
        status: 'draft',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        amountReceived: 800_000,
        discountAmount: 200_000,
        siblingDiscountAmount: 100_000,
        siblingDiscount: true,
      },
      studentData: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' },
      siblingGroupDocs: [
        { id: 'stu-1', data: { siblingGroupId: 'g1', studentLifecycle: 'enrolled' } },
        { id: 'stu-2', data: { siblingGroupId: 'g1', studentLifecycle: 'archived' } },
      ],
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'post', id: 'receipt-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const receiptUpdateCall = tx.update.mock.calls.find((call: any[]) => call[0] === receiptRef);
    expect(receiptUpdateCall[1]).toMatchObject({ discountAmount: 100_000 });
    expect(receiptUpdateCall[1]).toHaveProperty('siblingDiscountAmount');
    expect(tx.update).toHaveBeenCalledWith(
      ledgerRef,
      expect.objectContaining({ siblingDiscountTotal: 0 })
    );
  });

  it('does not read from DocumentStore after the first write in post (all reads precede all writes)', async () => {
    const { db } = buildSiblingPostDb({
      ledger: { amount: 1_000_000, paidTotal: 0, discountTotal: 0, siblingDiscountTotal: 0 },
      receipt: {
        status: 'draft',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        amountReceived: 900_000,
        discountAmount: 100_000,
      },
      studentData: {},
      siblingGroupDocs: [],
      getsAfterFirstWriteThrow: true,
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'post', id: 'receipt-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
  });

  it('does not read from DocumentStore after the first write in create-and-post', async () => {
    const receiptRef = { id: 'receipt-1', path: 'receipts/receipt-1' };
    const ledgerRef = { id: 'ledger-1', path: 'course_fee_ledgers/ledger-1' };
    const idempotencyRef = {
      id: 'admin-uid:sibling-order-1',
      path: 'finance_idempotency_keys/admin-uid:sibling-order-1',
    };
    const studentRef = { id: 'stu-1', path: 'students/stu-1' };
    const siblingGroupQuery: any = { path: 'students_sibling_group_query' };
    siblingGroupQuery.where = vi.fn(() => siblingGroupQuery);
    const activePaymentsQuery: any = { path: 'payment_requests_query' };
    activePaymentsQuery.where = vi.fn(() => activePaymentsQuery);

    let wroteOnce = false;
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === '_counters') {
          return { doc: vi.fn((id: string) => ({ id, path: `_counters/${id}` })) };
        }
        if (name === 'finance_idempotency_keys') return { doc: vi.fn(() => idempotencyRef) };
        if (name === 'receipts') {
          const receiptNumberQuery: any = { path: 'receipt_number_query' };
          receiptNumberQuery.where = vi.fn(() => receiptNumberQuery);
          receiptNumberQuery.orderBy = vi.fn(() => receiptNumberQuery);
          receiptNumberQuery.limit = vi.fn(() => receiptNumberQuery);
          return {
            doc: vi.fn(() => receiptRef),
            where: vi.fn(() => receiptNumberQuery),
          };
        }
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'payment_requests') return { where: vi.fn(() => activePaymentsQuery) };
        if (name === 'students') {
          return { doc: vi.fn(() => studentRef), where: vi.fn(() => siblingGroupQuery) };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => {
        const tx = {
          get: vi.fn(async (target: any) => {
            if (wroteOnce) throw new Error('DocumentStore read after write is not allowed');
            if (String(target.path || '').startsWith('_counters/')) {
              return { exists: false, data: () => ({}) };
            }
            if (String(target.path || '') === 'receipt_number_query')
              return { empty: true, docs: [] };
            if (target === idempotencyRef) return { exists: false, data: () => ({}) };
            if (target === ledgerRef) {
              return makeDoc({
                studentId: 'stu-1',
                classId: 'class-1',
                amount: 1_000_000,
                paidTotal: 0,
                discountTotal: 0,
              });
            }
            if (target === studentRef) return makeDoc({});
            if (target === siblingGroupQuery) return { docs: [] };
            if (target === activePaymentsQuery) return { empty: true, size: 0, docs: [] };
            return makeDoc({}, false);
          }),
          set: vi.fn(() => {
            wroteOnce = true;
          }),
          update: vi.fn(() => {
            wroteOnce = true;
          }),
          create: vi.fn(() => {
            wroteOnce = true;
          }),
        };
        return callback(tx);
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'create-and-post' },
        body: {
          idempotencyKey: 'sibling-order-1',
          studentId: 'stu-1',
          classId: 'class-1',
          ledgerId: 'ledger-1',
          amountReceived: 900_000,
          paymentMethod: 'cash',
          receivedDate: '2026-05-13',
          discountType: 'none',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
  });

  it('decrements siblingDiscountTotal on void without going below zero', async () => {
    const receiptData = {
      status: 'posted',
      ledgerId: 'ledger-1',
      studentId: 'stu-1',
      amountReceived: 800_000,
      discountAmount: 200_000,
      siblingDiscountAmount: 100_000,
    };
    const receiptRef = {
      id: 'receipt-1',
      path: 'receipts/receipt-1',
      get: vi.fn(async () => makeDoc(receiptData)),
    };
    const ledgerRef = { id: 'ledger-1', path: 'course_fee_ledgers/ledger-1' };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === receiptRef) {
          return makeDoc(receiptData);
        }
        if (target === ledgerRef) {
          return makeDoc({
            amount: 1_000_000,
            paidTotal: 800_000,
            discountTotal: 200_000,
            siblingDiscountTotal: 50_000,
          });
        }
        return makeDoc({}, false);
      }),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'void', id: 'receipt-1' },
        body: { voidReason: 'test' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      ledgerRef,
      expect.objectContaining({ siblingDiscountTotal: 0 })
    );
  });

  it('rejects voiding a wallet-deposit receipt before touching the ledger', async () => {
    const receiptData = {
      status: 'posted',
      walletDeposit: true,
      studentId: 'stu-1',
      amountReceived: 500_000,
    };
    const receiptRef = {
      id: 'receipt-2',
      path: 'receipts/receipt-2',
      get: vi.fn(async () => makeDoc(receiptData)),
    };
    const ledgerRef = { id: 'ledger-1', path: 'course_fee_ledgers/ledger-1' };
    const ledgerGet = vi.fn(async () => makeDoc({ studentId: 'stu-1', classId: 'class-1' }));
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === receiptRef) {
          return makeDoc(receiptData);
        }
        if (target === ledgerRef) return ledgerGet();
        return makeDoc({}, false);
      }),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'void', id: 'receipt-2' },
        body: { voidReason: 'test' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Student Wallets tab/);
    expect(ledgerGet).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/finance/receipts/:id/void wallet v2 validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid', role: 'admin' } as any);
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'admin-uid', role: 'admin' },
      context: { uid: 'admin-uid', role: 'admin', name: 'Admin' },
    } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name !== 'receipts') return {};
        return {
          doc: vi.fn(() => ({
            id: 'receipt-v2',
            path: 'receipts/receipt-v2',
            get: vi.fn().mockResolvedValue(
              makeDoc({
                flowVersion: 'wallet-manual-v2',
                status: 'posted',
                studentId: 'student-1',
                transactionGroupId: 'receipt:receipt-v2',
              })
            ),
          })),
        };
      }),
    } as any);
    vi.mocked(voidWalletManualReceipt).mockResolvedValue({
      replay: false,
      response: { success: true, newBalance: 500 },
    });
  });

  it('rejects a v2 void without a reason and idempotency key', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'void', id: 'receipt-v2' },
        body: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(voidWalletManualReceipt).not.toHaveBeenCalled();
  });

  it('passes a complete v2 void request to the atomic helper', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'receipts', action: 'void', id: 'receipt-v2' },
        body: { idempotencyKey: 'void-key', reason: 'Thu nhầm học sinh' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(voidWalletManualReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        receiptId: 'receipt-v2',
        idempotencyKey: 'void-key',
        reason: 'Thu nhầm học sinh',
        uid: 'admin-uid',
      })
    );
  });
});

describe('POST /api/v1/finance/expenses/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T03:00:00.000Z'));
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid', role: 'admin' } as any);
    vi.mocked(verifyAuthContext).mockImplementation(async (req, res, requiredRoles) => {
      const decoded = await verifyAuthToken(req, res, requiredRoles);
      if (!decoded) return null;
      const userInfo = await getUserRoleAndName(null as any, decoded.uid, decoded.email).catch(
        () => ({ role: 'admin', name: 'Admin' })
      );
      return {
        decoded,
        context: {
          uid: decoded.uid,
          email: decoded.email,
          role: userInfo.role as any,
          name: userInfo.name || 'Admin',
        },
      } as any;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores duplicate client expense numbers and allocates unique server numbers', async () => {
    const { db, createdExpenses } = mockExpenseCreateDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const body = {
      expenseNo: 'CLIENT-DUPLICATE',
      category: 'supplies',
      amount: 250000,
      paidDate: '2026-05-13',
      payee: 'Vendor A',
      note: 'Markers',
      purpose: '',
      status: 'draft',
    };

    const firstRes = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'expenses', action: 'create' },
        body,
      } as any,
      firstRes
    );

    const secondRes = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'expenses', action: 'create' },
        body,
      } as any,
      secondRes
    );

    const firstExpense = createdExpenses[0];
    const secondExpense = createdExpenses[1];

    expect(firstRes.statusCode).toBe(201);
    expect(secondRes.statusCode).toBe(201);
    expect(firstRes.body).toMatchObject({
      success: true,
      expenseNo: expect.stringMatching(/^PC-\d{6}-\d{3}$/),
    });
    expect(secondRes.body).toMatchObject({
      success: true,
      expenseNo: expect.stringMatching(/^PC-\d{6}-\d{3}$/),
    });
    expect(firstExpense.expenseNo).toMatch(/^PC-\d{6}-\d{3}$/);
    expect(secondExpense.expenseNo).toMatch(/^PC-\d{6}-\d{3}$/);
    expect(firstExpense.expenseNo).not.toBe(secondExpense.expenseNo);
    expect(firstExpense.expenseNo).not.toBe('CLIENT-DUPLICATE');
    expect(db.runTransaction).toHaveBeenCalledTimes(2);
  });

  it('create-and-post is idempotent for repeated expense submissions', async () => {
    const { db, createdExpenses } = mockExpenseCreateDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const body = {
      idempotencyKey: 'expense-submit-1',
      category: 'supplies',
      amount: 250000,
      paidDate: '2026-05-13',
      payee: 'Vendor A',
      note: 'Markers',
      purpose: '',
    };

    const firstRes = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'expenses', action: 'create-and-post' },
        body,
      } as any,
      firstRes
    );

    const secondRes = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { resource: 'expenses', action: 'create-and-post' },
        body,
      } as any,
      secondRes
    );

    expect(firstRes.statusCode).toBe(201);
    expect(secondRes.statusCode).toBe(200);
    expect(firstRes.body).toMatchObject({ success: true, status: 'posted' });
    expect(secondRes.body).toMatchObject(firstRes.body);
    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0]).toMatchObject({ status: 'posted', amount: 250000 });
  });
});

describe('student wallet refund expenses', () => {
  const userInfo = { role: 'accounting', name: 'Kế toán A' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function createRefund(db: ReturnType<typeof makeExpenseWalletDb>, overrides = {}) {
    vi.mocked(getDb).mockReturnValue(db as never);
    const res = mockRes();
    await handleExpenses(
      {
        method: 'POST',
        body: {
          idempotencyKey: 'refund-key',
          type: 'wallet_refund',
          studentId: 's1',
          amount: 500,
          paidDate: '2026-07-27',
          payee: 'Phụ huynh Nguyễn An',
          reason: 'Học sinh nghỉ học',
          ...overrides,
        },
        headers: {},
      } as never,
      res,
      '',
      'create-and-post',
      'u1',
      userInfo
    );
    return res;
  }

  it('posts a student refund expense and wallet transaction atomically', async () => {
    const db = makeExpenseWalletDb({
      'students/s1': { name: 'Nguyễn An', walletBalance: 700 },
    });
    const res = await createRefund(db);

    expect(res.statusCode).toBe(201);
    expect(db.docs.get('students/s1')?.walletBalance).toBe(200);
    const refundRow = [...db.docs.entries()]
      .filter(([path]) => path.startsWith('wallet_transactions/'))
      .map(([, data]) => data)
      .find((data) => data.type === 'refund');
    expect(refundRow).toMatchObject({
      schemaVersion: 2,
      type: 'refund',
      source: 'student_refund',
      amount: 500,
      status: 'posted',
      expenseId: expect.any(String),
      expenseNo: expect.stringMatching(/^PC-/),
    });
    const expenseRow = [...db.docs.entries()]
      .filter(([path]) => path.startsWith('expenses/'))
      .map(([, data]) => data)[0];
    expect(expenseRow).toMatchObject({
      type: 'wallet_refund',
      studentId: 's1',
      walletTransactionId: expect.any(String),
      reason: 'Học sinh nghỉ học',
      status: 'posted',
    });
  });

  it('rejects a refund above the server wallet balance without writing money rows', async () => {
    const db = makeExpenseWalletDb({
      'students/s1': { name: 'Nguyễn An', walletBalance: 400 },
    });
    const res = await createRefund(db);

    expect(res.statusCode).toBe(400);
    expect(db.docs.get('students/s1')?.walletBalance).toBe(400);
    expect([...db.docs.keys()].filter((path) => path.startsWith('expenses/'))).toHaveLength(0);
    expect(
      [...db.docs.keys()].filter((path) => path.startsWith('wallet_transactions/'))
    ).toHaveLength(0);
  });

  it('replays the same refund idempotently without double-spending the wallet', async () => {
    const db = makeExpenseWalletDb({
      'students/s1': { name: 'Nguyễn An', walletBalance: 700 },
    });
    const first = await createRefund(db);
    const second = await createRefund(db);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(db.docs.get('students/s1')?.walletBalance).toBe(200);
    expect([...db.docs.keys()].filter((path) => path.startsWith('expenses/'))).toHaveLength(1);
    expect(
      [...db.docs.keys()].filter((path) => path.startsWith('wallet_transactions/'))
    ).toHaveLength(1);
  });

  it('voids a refund and restores the wallet while voiding the linked transaction', async () => {
    const db = makeExpenseWalletDb({
      'students/s1': { name: 'Nguyễn An', walletBalance: 700 },
    });
    const created = await createRefund(db);
    const res = mockRes();
    await handleExpenses(
      { method: 'POST', body: { reason: 'Hoàn nhầm' }, headers: {} } as never,
      res,
      created.body.id,
      'void',
      'u1',
      userInfo
    );

    expect(res.statusCode).toBe(200);
    expect(db.docs.get('students/s1')?.walletBalance).toBe(700);
    expect(db.docs.get(`expenses/${created.body.id}`)?.status).toBe('void');
    const walletTransactionId = String(
      db.docs.get(`expenses/${created.body.id}`)?.walletTransactionId
    );
    expect(db.docs.get(`wallet_transactions/${walletTransactionId}`)).toMatchObject({
      status: 'void',
      voidReason: 'Hoàn nhầm',
    });
  });

  it('voids a generic expense without touching any student wallet', async () => {
    const db = makeExpenseWalletDb({
      'students/s1': { name: 'Nguyễn An', walletBalance: 700 },
      'expenses/e1': {
        type: 'activity',
        status: 'posted',
        amount: 500,
        expenseNo: 'PC-001',
      },
    });
    vi.mocked(getDb).mockReturnValue(db as never);
    const res = mockRes();
    await handleExpenses(
      { method: 'POST', body: { reason: 'Hủy chi phí' }, headers: {} } as never,
      res,
      'e1',
      'void',
      'u1',
      userInfo
    );

    expect(res.statusCode).toBe(200);
    expect(db.docs.get('students/s1')?.walletBalance).toBe(700);
    expect(db.docs.get('expenses/e1')?.status).toBe('void');
  });
});
