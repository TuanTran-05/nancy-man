import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../../server/api/payments/payos/route';
import {
  normalizePaymentForApi,
  postConfirmedPayment,
} from '../../../server/api/payments/payos/handlers/shared.js';
import {
  getDb,
  verifyAuthToken,
  verifyAuthContext,
} from '../../../server/api/lib/auth/verifyAuth.js';
import { clearAllReadCaches } from '../../../server/api/lib/cache/readCache.js';
import { getPayOSClient } from '../../../server/api/lib/payments/payosClient.js';
import { reserveNextCounterSequence } from '../../../server/api/lib/documentStore/counterSequence.js';
import {
  getNextReceiptNumber,
  sendNeedsReviewNotification,
  sendServerPaymentConfirmation,
} from '../../../server/api/lib/payments/tuitionPayments.js';

vi.mock('../../../server/api/lib/auth/verifyAuth.js', () => {
  const getDb = vi.fn();
  const verifyAuthToken = vi.fn();
  const verifyAuthContext = vi.fn(async (req: any, res: any, requiredRoles: any) => {
    const decoded = await verifyAuthToken(req, res, requiredRoles);
    if (!decoded) return null;
    const db = getDb();
    let role = decoded.role || 'parent';
    let name = 'Mock Parent';
    let studentId = 'student-1';
    try {
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        role = data.role || role;
        name = data.displayName || data.name || name;
        studentId = data.studentId || studentId;
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
        studentId,
      },
    };
  });
  return { getDb, verifyAuthToken, verifyAuthContext };
});
vi.mock('../../../server/api/lib/payments/payosClient.js', () => ({
  getPayOSClient: vi.fn(),
}));

vi.mock('../../../server/api/lib/documentStore/counterSequence.js', () => ({
  compactDateKey: vi.fn(() => '260516'),
  reserveNextCounterSequence: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 99 }),
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  writeRequiredAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../../server/api/lib/payments/tuitionPayments.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => ({ __increment: value })),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
  formatDateForZalo: vi.fn((value: string) => value),
  getNextPayOSOrderCode: vi.fn().mockResolvedValue(2605160001),
  getNextReceiptNumber: vi.fn().mockResolvedValue('PT-260516-001'),
  getRemainingTuition: vi.fn(
    (ledger: any) => (ledger.amount || 0) - (ledger.paidTotal || 0) - (ledger.discountTotal || 0)
  ),
  sendServerPaymentConfirmation: vi.fn().mockResolvedValue(undefined),
  sendNeedsReviewNotification: vi.fn().mockResolvedValue(undefined),
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
  res._getJSONData = vi.fn(() => res.body);
  res.end = vi.fn();
  return res;
}

function makeDoc(data: any, options: { exists?: boolean; id?: string; ref?: any } = {}) {
  return {
    id: options.id || 'doc-id',
    exists: options.exists ?? true,
    ref: options.ref || { id: options.id || 'doc-id', update: vi.fn() },
    data: () => data,
  };
}

const futurePayOSExpiry = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function makeCreateDb(ledgerData: any) {
  const transactionEvents: string[] = [];
  const maintenanceRef = {
    id: 'student_identity',
    path: '_maintenance/student_identity',
    get: vi.fn().mockResolvedValue(makeDoc({ mode: 'normal' })),
  };
  const lockRef = { id: 'lock-1' };
  const ledgerRef = { id: 'ledger-ref', get: vi.fn().mockResolvedValue(makeDoc(ledgerData)) };
  const paymentRef = { id: 'payment-1', set: vi.fn().mockResolvedValue(undefined) };
  const orderCodeRef = { id: '2605160001', path: 'payment_order_codes/2605160001' };
  const invoiceRef = { id: 'invoice-1' };
  const invoiceQuery: any = {
    where: vi.fn(() => invoiceQuery),
    limit: vi.fn(() => invoiceQuery),
  };
  const activeSessionsQuery: any = {
    where: vi.fn(() => activeSessionsQuery),
    limit: vi.fn(() => activeSessionsQuery),
    get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] }),
  };
  const paymentCollection = {
    doc: vi.fn(() => paymentRef),
    where: vi.fn(() => activeSessionsQuery),
  };
  const lockCollection = { doc: vi.fn(() => lockRef) };
  const orderCodeCollection = { doc: vi.fn(() => orderCodeRef) };
  const invoiceCollection = { doc: vi.fn(() => invoiceRef), where: vi.fn(() => invoiceQuery) };
  const tx = {
    get: vi.fn(async (target: any) => {
      transactionEvents.push(
        target === maintenanceRef
          ? 'get:maintenance'
          : target === lockRef
            ? 'get:payment-lock'
            : 'get:business-document'
      );
      if (target === maintenanceRef) {
        return makeDoc({ mode: 'normal' });
      }
      if (target === lockRef) return makeDoc({}, { exists: false });
      if (target === ledgerRef) return makeDoc(ledgerData);
      if (target === invoiceQuery) return { empty: true, docs: [] };
      return makeDoc({}, { exists: false });
    }),
    set: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const db: any = {
    doc: vi.fn((path: string) => {
      if (path === '_maintenance/student_identity') return maintenanceRef;
      throw new Error(`Unexpected document path: ${path}`);
    }),
    collection: vi.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({ studentId: 'stu-1' })) })),
        };
      }
      if (name === 'course_fee_ledgers') {
        return { doc: vi.fn(() => ledgerRef) };
      }
      if (name === 'students') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(makeDoc({ name: 'Student A', contact: '0384072314' })),
          })),
        };
      }
      if (name === 'classes') {
        return {
          doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(makeDoc({ name: 'Class A' })) })),
        };
      }
      if (name === 'payment_requests') return paymentCollection;
      if (name === '_payment_locks') return lockCollection;
      if (name === 'payment_order_codes') return orderCodeCollection;
      if (name === 'invoices') return invoiceCollection;
      return {};
    }),
    runTransaction: vi.fn(async (callback: any) => callback(tx)),
  };

  return {
    db,
    paymentCollection,
    paymentRef,
    orderCodeRef,
    invoiceRef,
    maintenanceRef,
    transactionEvents,
    tx,
  };
}

function makeWebhookEventDoc() {
  return {
    get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
    create: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

describe('payOS payment API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllReadCaches();
    delete process.env.CRON_SECRET;
    process.env.PAYOS_ENABLED = 'true';
    process.env.PAYOS_CLIENT_ID = 'payos-client';
    process.env.PAYOS_API_KEY = 'payos-api-key';
    process.env.PAYOS_CHECKSUM_KEY = 'payos-checksum';
    process.env.PAYOS_RETURN_URL = 'https://vps.thienuy.edu.vn/parent/tuition';
    process.env.PAYOS_CANCEL_URL = 'https://vps.thienuy.edu.vn/parent/tuition';
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'parent-uid' } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        create: vi.fn().mockResolvedValue({
          checkoutUrl: 'https://pay.payos.vn/checkout',
          paymentLinkId: 'link-1',
        }),
      },
      webhooks: {
        verify: vi.fn().mockResolvedValue({
          orderCode: 2605160001,
          amount: 500000,
          paymentLinkId: 'link-1',
          reference: 'TF123',
          transactionDateTime: '2026-05-16 01:00:00',
          code: '00',
        }),
      },
    } as any);
  });

  it('rejects provider actions before auth or SDK access when PayOS is disabled', async () => {
    process.env.PAYOS_ENABLED = 'false';
    const res = mockRes();

    await handler(
      {
        method: 'POST',
        query: { action: 'create' },
        headers: {},
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: 'PAYOS_DISABLED' });
    expect(verifyAuthToken).not.toHaveBeenCalled();
    expect(getPayOSClient).not.toHaveBeenCalled();
  });

  it('normalizes DocumentStore timestamps in payment list payloads', () => {
    const payment = normalizePaymentForApi('payment-1', {
      orderCode: 2605160012,
      amount: 2000,
      createdAt: {
        toDate: () => new Date('2026-05-18T08:54:56.000Z'),
      },
      updatedAt: {
        _seconds: 1779094496,
        _nanoseconds: 123000000,
      },
    } as any);

    expect(payment.createdAt).toBe('2026-05-18T08:54:56.000Z');
    expect(payment.updatedAt).toBe('2026-05-18T08:54:56.123Z');
  });

  it('does not expose persisted gateway diagnostics in payment list payloads', () => {
    const payment = normalizePaymentForApi('payment-1', {
      status: 'create_failed',
      failureReason: 'PAYOS_CLIENT_SECRET=secret-key socket trace',
    } as any);

    expect(payment.reviewReason).toBe('Payment session could not be created');
    expect(JSON.stringify(payment)).not.toContain('secret-key');
    expect(JSON.stringify(payment)).not.toContain('socket trace');
  });

  it('paginates payment list responses with a cursor', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    const cursorDoc = makeDoc({ createdAt: '2026-05-16T01:00:00.000Z' }, { id: 'cursor-1' });
    const paymentDocs = [
      makeDoc(
        {
          orderCode: 2605160003,
          amount: 3000,
          status: 'pending',
          createdAt: '2026-05-16T03:00:00.000Z',
        },
        { id: 'payment-3' }
      ),
      makeDoc(
        {
          orderCode: 2605160002,
          amount: 2000,
          status: 'pending',
          createdAt: '2026-05-16T02:00:00.000Z',
        },
        { id: 'payment-2' }
      ),
      makeDoc(
        {
          orderCode: 2605160001,
          amount: 1000,
          status: 'pending',
          createdAt: '2026-05-16T01:00:00.000Z',
        },
        { id: 'payment-1' }
      ),
    ];
    const paymentQuery: any = {
      where: vi.fn(() => paymentQuery),
      orderBy: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      startAfter: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: paymentDocs }),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') {
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(cursorDoc) })),
            where: vi.fn(() => paymentQuery),
            orderBy: vi.fn(() => paymentQuery),
          };
        }
        return { doc: vi.fn() };
      }),
      getAll: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'list', status: 'pending', limit: '2', cursor: 'cursor-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(paymentQuery.limit).toHaveBeenCalledWith(3);
    expect(paymentQuery.startAfter).toHaveBeenCalledWith(cursorDoc);
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.page).toMatchObject({ limit: 2, hasMore: true, nextCursor: 'payment-2' });
  });

  it('defaults payment list responses to 2000 rows', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'accounting-uid' } as any);
    const paymentListQuery: any = {
      orderBy: vi.fn(() => paymentListQuery),
      limit: vi.fn(() => paymentListQuery),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const countQuery: any = {
      where: vi.fn(() => countQuery),
      count: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
      })),
    };
    const paymentCollection = {
      doc: vi.fn(),
      orderBy: vi.fn(() => paymentListQuery),
      where: vi.fn(() => countQuery),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentCollection;
        if (name === 'webhook_events') return countQuery;
        return { doc: vi.fn() };
      }),
      getAll: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'list' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(paymentListQuery.limit).toHaveBeenCalledWith(2001);
    expect(res.body.page).toMatchObject({ limit: 2000, hasMore: false, nextCursor: null });
  });

  it('returns payment health counts from timestamp-backed operational queries', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);
    const makeCountableQuery = (counts: number[]) => {
      const query: any = {
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        startAfter: vi.fn(() => query),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        count: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ data: () => ({ count: counts.shift() || 0 }) }),
        })),
      };
      return query;
    };
    const paymentQuery = makeCountableQuery([3, 2, 1, 5]);
    const webhookQuery = makeCountableQuery([4, 6]);
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentQuery;
        if (name === 'webhook_events') return webhookQuery;
        return { doc: vi.fn() };
      }),
      getAll: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      { method: 'GET', headers: {}, query: { action: 'list', status: 'all' } } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.health).toMatchObject({
      stuckPendingCount: 3,
      needsReviewCount: 2,
      createFailedCount: 1,
      staleCreatingGatewaySession: 5,
      failedWebhookCount24h: 4,
      staleProcessingWebhookCount: 6,
    });
    expect(paymentQuery.where).toHaveBeenCalledWith(
      'createdAt',
      '<=',
      expect.objectContaining({ toMillis: expect.any(Function) })
    );
    expect(webhookQuery.where).toHaveBeenCalledWith(
      'receivedAt',
      '>=',
      expect.objectContaining({ toMillis: expect.any(Function) })
    );
    expect(webhookQuery.where).toHaveBeenCalledWith(
      'leaseUntil',
      '<=',
      expect.objectContaining({ toMillis: expect.any(Function) })
    );
    expect(getPayOSClient).not.toHaveBeenCalled();
  });

  it('creates an embedded payment link for the parent ledger balance', async () => {
    const { db, paymentRef, orderCodeRef, invoiceRef, transactionEvents, tx } = makeCreateDb({
      studentId: 'stu-1',
      classId: 'class-1',
      amount: 700000,
      paidTotal: 200000,
      discountTotal: 0,
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: { origin: 'https://vps.thienuy.edu.vn' },
        query: { action: 'create' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(transactionEvents[0]).toBe('get:maintenance');
    expect(res.body).toMatchObject({
      success: true,
      checkoutUrl: 'https://pay.payos.vn/checkout',
      orderCode: 2605160001,
      amount: 500000,
    });
    expect(tx.set).toHaveBeenCalledWith(
      paymentRef,
      expect.objectContaining({
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        parentUid: 'parent-uid',
        amount: 500000,
        status: 'creating_gateway_session',
        nextReconcileAt: expect.anything(),
        reconcileAttempts: 0,
        lastReconciledAt: null,
      })
    );
    expect(tx.create).toHaveBeenCalledWith(
      orderCodeRef,
      expect.objectContaining({
        orderCode: 2605160001,
        paymentRequestId: 'payment-1',
        ledgerId: 'ledger-1',
        parentUid: 'parent-uid',
      })
    );
    expect(tx.create).toHaveBeenCalledWith(
      invoiceRef,
      expect.objectContaining({
        invoiceNo: 'INV-2605160001',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
        amountDue: 500000,
        ledgerAmountSnapshot: 700000,
        paidTotalSnapshot: 200000,
        status: 'issued',
      })
    );
    expect(tx.set).toHaveBeenCalledWith(
      paymentRef,
      expect.objectContaining({
        invoiceId: 'invoice-1',
        invoiceNo: 'INV-2605160001',
        invoiceAmountSnapshot: 500000,
      })
    );
    expect(paymentRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        paymentLinkId: 'link-1',
      }),
      { merge: true }
    );
  });

  it('rejects creating a link for another student ledger', async () => {
    const { db } = makeCreateDb({
      studentId: 'other-student',
      classId: 'class-1',
      amount: 700000,
      paidTotal: 0,
    });
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'create' },
        body: { ledgerId: 'ledger-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ success: false });
  });

  it('rejects webhook payloads with invalid signatures', async () => {
    vi.mocked(getPayOSClient).mockReturnValue({
      webhooks: {
        verify: vi
          .fn()
          .mockRejectedValue(new Error('PAYOS_CLIENT_SECRET=secret-key bad signature')),
      },
    } as any);
    const webhookEventDoc = makeWebhookEventDoc();
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: { code: '00', success: true, data: {}, signature: 'bad' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: 'Invalid webhook signature' });
    expect(webhookEventDoc.create).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid webhook signature' })
    );
    expect(JSON.stringify(webhookEventDoc.create.mock.calls)).not.toContain('secret-key');
  });

  it('passes the full webhook envelope to the payOS verifier', async () => {
    const verify = vi.fn().mockResolvedValue({
      orderCode: 2605160001,
      amount: 500000,
      paymentLinkId: 'link-1',
      reference: 'TF123',
      transactionDateTime: '2026-05-16 01:00:00',
      code: '01',
    });
    vi.mocked(getPayOSClient).mockReturnValue({
      webhooks: { verify },
    } as any);
    const webhookEventDoc = makeWebhookEventDoc();
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        return {};
      }),
    } as any);
    const body = {
      code: '01',
      desc: 'failed',
      success: false,
      data: { code: '01' },
      signature: 'sig',
    };

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body,
      } as any,
      res
    );

    expect(verify).toHaveBeenCalledWith(body);
  });

  it('stores the documented webhook envelope fields for audit and reconciliation', async () => {
    const webhookEventDoc = makeWebhookEventDoc();
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        return {};
      }),
    } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      webhooks: {
        verify: vi.fn().mockResolvedValue({
          orderCode: 2605160001,
          amount: 500000,
          paymentLinkId: 'link-1',
          reference: 'TF123',
          transactionDateTime: '2026-05-16 01:00:00',
          code: '01',
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: {
          code: '01',
          desc: 'failed',
          success: false,
          data: { code: '01', desc: 'Failed transaction' },
          signature: 'ok',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(webhookEventDoc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        envelopeCode: '01',
        envelopeDesc: 'failed',
        envelopeSuccess: false,
        processingStatus: 'processing',
      })
    );
    expect(webhookEventDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: 'ignored' }),
      { merge: true }
    );
  });

  it('opens a review case for valid PayOS webhooks with unknown orderCode', async () => {
    const webhookEventDoc = makeWebhookEventDoc();
    const paymentReviewCasesSet = vi.fn().mockResolvedValue(undefined);
    const paymentReviewCasesDoc = vi.fn(() => ({ set: paymentReviewCasesSet }));
    vi.mocked(sendNeedsReviewNotification).mockRejectedValueOnce(new Error('notify failed'));
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        if (name === 'payment_requests') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
              })),
            })),
          };
        }
        if (name === 'payment_review_cases') {
          return { doc: paymentReviewCasesDoc };
        }
        return {};
      }),
    } as any;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(getPayOSClient).mockReturnValue({
      webhooks: {
        verify: vi.fn().mockResolvedValue({
          orderCode: 123456,
          amount: 500000,
          paymentLinkId: 'link-orphan',
          reference: 'TF123',
          transactionDateTime: '2026-05-16 01:00:00',
          code: '00',
        }),
      },
    } as any);

    const response = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: {
          code: '00',
          desc: 'success',
          success: true,
          data: { code: '00', orderCode: 123456, amount: 500000 },
          signature: 'ok',
        },
      } as any,
      response
    );

    expect(response.statusCode).toBe(200);
    expect(response._getJSONData()).toMatchObject({ success: true, needsReview: true });
    expect(paymentReviewCasesDoc).toHaveBeenCalledWith('payos_orphan_123456');
    expect(paymentReviewCasesSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'open',
        severity: 'critical',
        source: 'payos_webhook',
        category: 'orphan_payment',
        orderCode: 123456,
        amount: 500000,
        gatewayReference: 'TF123',
        rawEventId: expect.any(String),
        reason: 'Valid PayOS webhook did not match any payment request',
      }),
      { merge: true }
    );
    expect(paymentReviewCasesSet.mock.invocationCallOrder[0]).toBeLessThan(
      webhookEventDoc.set.mock.invocationCallOrder[0]
    );
    expect(sendNeedsReviewNotification).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        paymentId: 'payos_orphan_123456',
        orderCode: 123456,
        amount: 500000,
        reason: 'Valid PayOS webhook did not match any payment request',
      })
    );
  });

  it('deduplicates verified webhook retries by provider event identity', async () => {
    const providerEvent = {
      orderCode: 2605160001,
      amount: 500000,
      paymentLinkId: 'link-1',
      reference: 'TF123',
      transactionDateTime: '2026-05-16 01:00:00',
      code: '01',
    };
    vi.mocked(getPayOSClient).mockReturnValue({
      webhooks: {
        verify: vi.fn().mockResolvedValue(providerEvent),
      },
    } as any);

    const docIds: string[] = [];
    const docs = new Map<string, any>();
    function getWebhookEventDoc(id: string) {
      docIds.push(id);
      if (!docs.has(id)) {
        const state: { exists: boolean; data?: Record<string, unknown> } = { exists: false };
        docs.set(id, {
          get: vi.fn().mockImplementation(async () => ({
            exists: state.exists,
            data: () => state.data,
          })),
          create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
            if (state.exists) throw { code: 6, message: 'ALREADY_EXISTS' };
            state.exists = true;
            state.data = data;
          }),
          set: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
            state.exists = true;
            state.data = { ...(state.data || {}), ...data };
          }),
        });
      }
      return docs.get(id);
    }

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'webhook_events') return { doc: vi.fn(getWebhookEventDoc) };
        return {};
      }),
    } as any);

    const first = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: {
          code: '01',
          desc: 'failed',
          success: false,
          data: { code: '01', orderCode: 2605160001 },
          signature: 'ok',
        },
      } as any,
      first
    );

    const second = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: {
          success: false,
          code: '01',
          desc: 'gateway retry with different envelope text',
          data: { orderCode: 2605160001, code: '01', ignoredField: 'changed' },
          signature: 'ok',
        },
      } as any,
      second
    );

    expect(first.body).toMatchObject({ success: true, ignored: true });
    expect(second.body).toMatchObject({ success: true, duplicate: true, skipped: true });
    expect(new Set(docIds).size).toBe(1);
  });

  it('handles duplicate paid webhooks without creating another receipt', async () => {
    const paymentRef = { id: 'payment-1', update: vi.fn() };
    const paymentDoc = makeDoc(
      {
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        status: 'paid',
        receiptId: 'receipt-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [paymentDoc] }),
    };
    const tx = {
      get: vi.fn().mockResolvedValue(paymentDoc),
      create: vi.fn(),
      update: vi.fn(),
    };
    const webhookEventDoc = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ processingStatus: 'processed' }),
      }),
      create: vi.fn().mockRejectedValue({ code: 6, message: 'ALREADY_EXISTS' }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        return { doc: vi.fn(() => ({ id: `${name}-doc` })) };
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: { code: '00', success: true, data: { code: '00' }, signature: 'ok' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, duplicate: true, skipped: true });
    expect(webhookEventDoc.set).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
    expect(sendServerPaymentConfirmation).not.toHaveBeenCalled();
  });

  it('reprocesses stale processing webhook retries instead of skipping them', async () => {
    const paymentRef = { id: 'payment-1' };
    const ledgerRef = { id: 'ledger-1' };
    const studentRef = { id: 'stu-1' };
    const classRef = { id: 'class-1' };
    const receiptRef = { id: 'receipt-1' };
    const paymentDoc = makeDoc(
      {
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        status: 'pending',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [paymentDoc] }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return paymentDoc;
        if (target === ledgerRef) {
          return makeDoc({ amount: 500000, paidTotal: 0, discountTotal: 0 });
        }
        if (target === studentRef) return makeDoc({ name: 'Student A', contact: '0384072314' });
        if (target === classRef) return makeDoc({ name: 'Class A' });
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    const webhookEventDoc = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          processingStatus: 'processing',
          attempts: 1,
          leaseUntil: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
      create: vi.fn().mockRejectedValue({ code: 6, message: 'ALREADY_EXISTS' }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        return { doc: vi.fn(() => ({ id: `${name}-doc` })) };
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: { code: '00', success: true, data: { code: '00' }, signature: 'ok' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      processed: true,
      receiptId: 'receipt-1',
      processingStatus: 'posted',
    });
    expect(tx.create).toHaveBeenCalledWith(
      receiptRef,
      expect.objectContaining({ source: 'payos' })
    );
    expect(webhookEventDoc.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        processingStatus: 'posted',
        paymentRequestId: 'payment-1',
        receiptId: 'receipt-1',
      }),
      { merge: true }
    );
  });

  it('never downgrades a paid payment when a mismatch webhook races with posting', async () => {
    const paymentRef = { id: 'payment-1' };
    const initialPaymentDoc = makeDoc(
      {
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        status: 'pending',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const freshPaidDoc = makeDoc(
      {
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        status: 'paid',
        receiptId: 'receipt-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [initialPaymentDoc] }),
    };
    const tx = {
      get: vi.fn().mockResolvedValue(freshPaidDoc),
      create: vi.fn(),
      update: vi.fn(),
    };
    const webhookEventDoc = makeWebhookEventDoc();
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        return { doc: vi.fn(() => ({ id: `${name}-doc` })) };
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(getPayOSClient).mockReturnValue({
      webhooks: {
        verify: vi.fn().mockResolvedValue({
          orderCode: 2605160001,
          amount: 400000,
          paymentLinkId: 'wrong-link',
          reference: 'TF999',
          transactionDateTime: '2026-05-16 01:05:00',
          code: '00',
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: { code: '00', success: true, data: { code: '00' }, signature: 'ok' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, alreadyPaid: true, receiptId: 'receipt-1' });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('routes webhook amount mismatches above ten percent to review', async () => {
    const paymentRef = { id: 'payment-1' };
    const paymentDoc = makeDoc(
      {
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        status: 'pending',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [paymentDoc] }),
    };
    const tx = {
      get: vi.fn().mockResolvedValue(paymentDoc),
      create: vi.fn(),
      update: vi.fn(),
    };
    const webhookEventDoc = makeWebhookEventDoc();
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        return { doc: vi.fn(() => ({ id: `${name}-doc` })) };
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(getPayOSClient).mockReturnValue({
      webhooks: {
        verify: vi.fn().mockResolvedValue({
          orderCode: 2605160001,
          amount: 650000,
          paymentLinkId: 'link-1',
          reference: 'TF999',
          transactionDateTime: '2026-05-16 01:05:00',
          code: '00',
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'webhook' },
        body: { code: '00', success: true, data: { code: '00' }, signature: 'ok' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, needsReview: true });
    expect(tx.update).toHaveBeenCalledWith(
      paymentRef,
      expect.objectContaining({
        status: 'needs_review',
        reviewResolution: 'manual_handling_required',
        reviewReason: 'Webhook amount mismatch',
        gatewayAmount: 650000,
      })
    );
    expect(sendNeedsReviewNotification).toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });

  it.each(['stale', 'failed', 'create_failed', 'cancelled', 'expired', 'manually_voided'])(
    'routes gateway-paid events for local %s payments to review',
    async (status) => {
      const paymentRef = { id: 'payment-1' };
      const paymentDoc = makeDoc(
        {
          orderCode: 2605160001,
          amount: 500000,
          paymentLinkId: 'link-1',
          status,
        },
        { id: 'payment-1', ref: paymentRef }
      );
      const paymentQuery: any = {
        limit: vi.fn(() => paymentQuery),
        get: vi.fn().mockResolvedValue({ empty: false, docs: [paymentDoc] }),
      };
      const tx = {
        get: vi.fn().mockResolvedValue(paymentDoc),
        create: vi.fn(),
        update: vi.fn(),
      };
      const webhookEventDoc = makeWebhookEventDoc();
      const db: any = {
        collection: vi.fn((name: string) => {
          if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
          if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
          return { doc: vi.fn(() => ({ id: `${name}-doc` })) };
        }),
        runTransaction: vi.fn(async (callback: any) => callback(tx)),
      };
      vi.mocked(getDb).mockReturnValue(db);
      vi.mocked(getPayOSClient).mockReturnValue({
        webhooks: {
          verify: vi.fn().mockResolvedValue({
            orderCode: 2605160001,
            amount: 500000,
            paymentLinkId: 'link-1',
            reference: 'TF123',
            transactionDateTime: '2026-05-16 01:05:00',
            code: '00',
          }),
        },
      } as any);

      const res = mockRes();
      await handler(
        {
          method: 'POST',
          headers: {},
          query: { action: 'webhook' },
          body: { code: '00', success: true, data: { code: '00' }, signature: 'ok' },
        } as any,
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.processingStatus).not.toBe('terminal_ignored');
      expect(tx.update).toHaveBeenCalledWith(
        paymentRef,
        expect.objectContaining({
          status: 'needs_review',
          previousStatus: status,
          reviewResolution: 'manual_handling_required',
          gatewayAmount: 500000,
          gatewayReference: 'TF123',
        })
      );
      expect(tx.create).not.toHaveBeenCalled();
    }
  );

  it('routes webhook overpayments to needs_review instead of posting a receipt', async () => {
    const paymentRef = { id: 'payment-1' };
    const ledgerRef = { id: 'ledger-1' };
    const studentRef = { id: 'stu-1' };
    const classRef = { id: 'class-1' };
    const receiptRef = { id: 'receipt-1' };
    const paymentDoc = makeDoc(
      {
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        status: 'pending',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [paymentDoc] }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return paymentDoc;
        if (target === ledgerRef) {
          return makeDoc({ amount: 700000, paidTotal: 500000, discountTotal: 0 });
        }
        if (target === studentRef) return makeDoc({ name: 'Student A' });
        if (target === classRef) return makeDoc({ name: 'Class A' });
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    const webhookEventDoc = makeWebhookEventDoc();
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        if (name === 'webhook_events') return { doc: vi.fn(() => webhookEventDoc) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
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
        query: { action: 'webhook' },
        body: { code: '00', success: true, data: { code: '00' }, signature: 'ok' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, needsReview: true });
    expect(tx.update).toHaveBeenCalledWith(
      paymentRef,
      expect.objectContaining({
        status: 'needs_review',
        reviewReason: expect.stringContaining('exceeds current remaining balance'),
      })
    );
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('rejects parent status reads for another parent payment', async () => {
    const paymentDoc = makeDoc(
      {
        parentUid: 'other-parent',
        studentId: 'stu-2',
        status: 'pending',
      },
      { id: 'payment-1' }
    );
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [paymentDoc] }),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ studentId: 'stu-1' })),
            })),
          };
        }
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'status', orderCode: '2605160001' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ success: false });
  });

  it('does not authorize reconcile with spoofed platform cron headers', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue(null);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { 'x-platform-cron': '1', 'user-agent': 'platform-cron/1.0' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'accounting']);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('authorizes reconcile only with the configured cron bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const paymentQuery: any = {
      where: vi.fn(() => paymentQuery),
      orderBy: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentQuery;
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(verifyAuthToken).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, checked: 0 });
  });

  it('reconciles due pending payment statuses', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const paymentQuery: any = {
      where: vi.fn(() => paymentQuery),
      orderBy: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentQuery;
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(paymentQuery.where).toHaveBeenCalledWith(
      'status',
      'in',
      expect.arrayContaining(['creating_gateway_session', 'pending'])
    );
    expect(paymentQuery.where).toHaveBeenCalledWith(
      'nextReconcileAt',
      '<=',
      expect.objectContaining({ toMillis: expect.any(Function) })
    );
    expect(paymentQuery.orderBy).toHaveBeenCalledWith('nextReconcileAt', 'asc');
    expect(paymentQuery.limit).toHaveBeenCalledWith(26);
  });

  it('posts paid payments from stale processing webhook events during reconciliation', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const paymentRef = { id: 'payment-1', update: vi.fn() };
    const ledgerRef = { id: 'ledger-1' };
    const studentRef = { id: 'stu-1' };
    const classRef = { id: 'class-1' };
    const receiptRef = { id: 'receipt-1' };
    const webhookEventRef = { id: 'webhook-1', update: vi.fn().mockResolvedValue(undefined) };
    const paymentDoc = makeDoc(
      {
        status: 'pending',
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paymentQuery: any = {
      filters: [] as Array<{ field: string; op: string; value: unknown }>,
      where: vi.fn((field: string, op: string, value: unknown) => {
        paymentQuery.filters.push({ field, op, value });
        return paymentQuery;
      }),
      orderBy: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockImplementation(async () => {
        const orderCodeFilter = paymentQuery.filters.find((filter) => filter.field === 'orderCode');
        if (orderCodeFilter) return { empty: false, size: 1, docs: [paymentDoc] };
        return { empty: true, size: 0, docs: [] };
      }),
    };
    const webhookQuery: any = {
      where: vi.fn(() => webhookQuery),
      limit: vi.fn(() => webhookQuery),
      get: vi.fn().mockResolvedValue({
        empty: false,
        size: 1,
        docs: [
          makeDoc(
            {
              processingStatus: 'processing',
              orderCode: 2605160001,
              paymentLinkId: 'link-1',
              leaseUntil: { toMillis: () => Date.now() - 60_000 },
            },
            { id: 'webhook-1', ref: webhookEventRef }
          ),
        ],
      }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return paymentDoc;
        if (target === ledgerRef)
          return makeDoc({ amount: 500000, paidTotal: 0, discountTotal: 0 });
        if (target === studentRef) return makeDoc({ name: 'Student A', contact: '0384072314' });
        if (target === classRef) return makeDoc({ name: 'Class A' });
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentQuery;
        if (name === 'webhook_events') return webhookQuery;
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockResolvedValue({
          id: 'link-1',
          orderCode: 2605160001,
          amount: 500000,
          status: 'PAID',
          transactions: [{ reference: 'TF123', transactionDateTime: '2026-05-16 01:00:00' }],
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.create).toHaveBeenCalledWith(
      receiptRef,
      expect.objectContaining({ paymentConfirmationSource: 'gateway_reconcile' })
    );
    expect(webhookEventRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: 'posted',
        paymentRequestId: 'payment-1',
        receiptId: 'receipt-1',
      })
    );
    expect(res.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'stale_webhook_posted' })])
    );
  });

  it('expires stale creating_gateway_session rows without a gateway link', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const update = vi.fn().mockResolvedValue(undefined);
    const staleCreatingDoc = makeDoc(
      {
        status: 'creating_gateway_session',
        createdAt: '2026-05-16T00:00:00.000Z',
        nextReconcileAt: { toMillis: () => 0 },
        reconcileAttempts: 0,
      },
      { id: 'payment-creating', ref: { update } }
    );
    const paymentQuery: any = {
      statusFilter: undefined as unknown,
      where: vi.fn((field: string, op: string, value: unknown) => {
        if (field === 'status') paymentQuery.statusFilter = { op, value };
        return paymentQuery;
      }),
      orderBy: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockImplementation(async () => {
        const statuses = paymentQuery.statusFilter?.value as string[] | undefined;
        const docs = statuses?.includes('creating_gateway_session') ? [staleCreatingDoc] : [];
        return { empty: docs.length === 0, size: docs.length, docs };
      }),
    };
    const tx = {
      get: vi.fn().mockResolvedValue(staleCreatingDoc),
      update: vi.fn(),
    };
    const payOSGet = vi.fn();
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: { get: payOSGet },
    } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentQuery;
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(payOSGet).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'create_failed',
        failureReason: expect.stringContaining('gateway session was not created'),
        lastReconciledAt: expect.anything(),
      })
    );
    expect(res.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'create_failed' })])
    );
  });

  it('backfills legacy pending rows missing nextReconcileAt', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const update = vi.fn().mockResolvedValue(undefined);
    const legacyPendingDoc = makeDoc(
      {
        status: 'pending',
        orderCode: 2605160001,
        paymentLinkId: 'link-legacy',
        createdAt: '2026-05-16T00:00:00.000Z',
        expiresAt: futurePayOSExpiry(),
        reconcileAttempts: 0,
      },
      { id: 'payment-legacy', ref: { update } }
    );
    let queryKind = 'due';
    const makePaymentQuery = () => {
      const query: any = {
        where: vi.fn((field: string) => {
          if (field === 'status') queryKind = queryKind === 'due' ? 'due' : 'legacy';
          return query;
        }),
        orderBy: vi.fn((field: string) => {
          if (field === 'createdAt') queryKind = 'legacy';
          return query;
        }),
        limit: vi.fn(() => query),
        get: vi.fn().mockImplementation(async () => {
          const docs = queryKind === 'legacy' ? [legacyPendingDoc] : [];
          return { empty: docs.length === 0, size: docs.length, docs };
        }),
      };
      return query;
    };
    const tx = {
      get: vi.fn().mockResolvedValue(legacyPendingDoc),
      update: vi.fn(),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return makePaymentQuery();
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockResolvedValue({
          status: 'PENDING',
          amountPaid: 0,
          amountRemaining: 500000,
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(getPayOSClient().paymentRequests.get).toHaveBeenCalledWith(2605160001);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        nextReconcileAt: expect.anything(),
        reconcileAttempts: { __increment: 1 },
      })
    );
  });

  it('skips rows with an active reconciliation lease', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const update = vi.fn().mockResolvedValue(undefined);
    const leasedDoc = makeDoc(
      {
        status: 'pending',
        orderCode: 2605160001,
        paymentLinkId: 'link-leased',
        nextReconcileAt: { toMillis: () => 0 },
        reconcileLeaseUntil: { toMillis: () => Date.now() + 60_000 },
      },
      { id: 'payment-leased', ref: { update } }
    );
    const paymentQuery: any = {
      where: vi.fn(() => paymentQuery),
      orderBy: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      get: vi
        .fn()
        .mockResolvedValueOnce({ empty: false, size: 1, docs: [leasedDoc] })
        .mockResolvedValue({ empty: true, size: 0, docs: [] }),
    };
    const tx = {
      get: vi.fn().mockResolvedValue(leasedDoc),
      update: vi.fn(),
    };
    const payOSGet = vi.fn();
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: { get: payOSGet },
    } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentQuery;
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(tx.update).not.toHaveBeenCalled();
    expect(payOSGet).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ success: true, checked: 0 });
  });

  it('reschedules checked pending rows so later due payments are reconciled on the next run', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    const pendingUpdates = new Map<number, ReturnType<typeof vi.fn>>();
    const pendingRows = Array.from({ length: 27 }, (_, index) => {
      const orderCode = index === 26 ? 999999 : 2605160001 + index;
      const state: Record<string, any> = {
        status: 'pending',
        orderCode,
        paymentLinkId: `link-${orderCode}`,
        createdAt: `2026-05-16T00:${String(index).padStart(2, '0')}:00.000Z`,
        expiresAt: futurePayOSExpiry(),
        nextReconcileAt: { toMillis: () => 0 },
        reconcileAttempts: 0,
        lastReconciledAt: null,
      };
      const update = vi.fn().mockImplementation(async (patch: Record<string, unknown>) => {
        Object.assign(state, patch);
      });
      pendingUpdates.set(orderCode, update);
      return makeDoc(state, { id: `payment-${orderCode}`, ref: { update } });
    });
    const checkedOrderCodes: number[][] = [];

    const makePaymentQuery = () => {
      const query: any = {
        limitValue: 25,
        statusFilter: undefined as unknown,
        nextReconcileBeforeOrAt: null as null | { toMillis?: () => number },
        where: vi.fn((field: string, op: string, value: unknown) => {
          if (field === 'status') query.statusFilter = { op, value };
          if (field === 'nextReconcileAt' && op === '<=') {
            query.nextReconcileBeforeOrAt = value as { toMillis?: () => number };
          }
          return query;
        }),
        orderBy: vi.fn(() => query),
        limit: vi.fn((value: number) => {
          query.limitValue = value;
          return query;
        }),
        startAfter: vi.fn(() => query),
        get: vi.fn().mockImplementation(async () => {
          let rows = pendingRows.filter((doc) => {
            const status = String(doc.data().status || '');
            if (!query.statusFilter) return true;
            if (query.statusFilter.op === '==') return status === query.statusFilter.value;
            if (query.statusFilter.op === 'in') {
              return (query.statusFilter.value as string[]).includes(status);
            }
            return true;
          });
          if (query.nextReconcileBeforeOrAt) {
            const dueAt = query.nextReconcileBeforeOrAt.toMillis?.() ?? 0;
            rows = rows.filter((doc) => {
              const value = doc.data().nextReconcileAt;
              const millis = typeof value?.toMillis === 'function' ? value.toMillis() : 0;
              return millis <= dueAt;
            });
          }
          rows = rows.slice(0, query.limitValue);
          checkedOrderCodes.push(rows.map((doc) => Number(doc.data().orderCode)));
          return { empty: rows.length === 0, size: rows.length, docs: rows };
        }),
      };
      return query;
    };

    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return makePaymentQuery();
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) =>
        callback({
          get: vi.fn(async (ref: any) => pendingRows.find((doc) => doc.ref === ref)),
          update: vi.fn(),
        })
      ),
    } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockResolvedValue({
          status: 'PENDING',
          amountPaid: 0,
          amountRemaining: 500000,
        }),
      },
    } as any);

    const firstRun = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      firstRun
    );

    const rescheduledPendingUpdate = pendingUpdates.get(2605160001);
    const secondRunStartIndex = checkedOrderCodes.length;
    const secondRun = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      secondRun
    );

    const secondRunCheckedOrderCodes = checkedOrderCodes.slice(secondRunStartIndex).flat();
    expect(firstRun._getJSONData()).toMatchObject({ success: true, partial: true });
    expect(rescheduledPendingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        lastReconciledAt: expect.anything(),
        nextReconcileAt: expect.anything(),
        reconcileAttempts: expect.anything(),
      })
    );
    expect(secondRunCheckedOrderCodes).toContain(999999);
  });

  it('does not persist payOS provider diagnostics when reconciliation fails', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const update = vi.fn().mockResolvedValue(undefined);
    const pendingDoc = makeDoc(
      {
        status: 'pending',
        orderCode: 2605160001,
        expiresAt: '2026-06-16T01:00:00.000Z',
        nextReconcileAt: { toMillis: () => 0 },
      },
      { id: 'payment-1', ref: { update } }
    );
    const paymentQuery: any = {
      where: vi.fn(() => paymentQuery),
      orderBy: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      startAfter: vi.fn(() => paymentQuery),
      get: vi
        .fn()
        .mockResolvedValue({ empty: true, size: 0, docs: [] })
        .mockResolvedValueOnce({ empty: false, size: 1, docs: [pendingDoc] }),
    };
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentQuery;
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) =>
        callback({
          get: vi.fn().mockResolvedValue(pendingDoc),
          update: vi.fn(),
        })
      ),
    } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockRejectedValue(new Error('PAYOS_CLIENT_SECRET=secret-key socket trace')),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { action: 'reconcile' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciliationError: 'Failed to query payOS',
        lastReconciledAt: expect.anything(),
        nextReconcileAt: expect.anything(),
        reconcileAttempts: { __increment: 1 },
      })
    );
    expect(res.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'lookup_failed' })])
    );
    expect(JSON.stringify(update.mock.calls)).not.toContain('secret-key');
  });

  it('does not authorize reconcile with cron_secret query parameters', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    vi.mocked(verifyAuthToken).mockResolvedValue(null);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'reconcile', cron_secret: 'cron-secret' },
      } as any,
      res
    );

    expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'accounting']);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('posts a paid gateway payment during parent status polling when webhook is missing', async () => {
    const paymentRef: any = { id: 'payment-1' };
    const ledgerRef = { id: 'ledger-1' };
    const studentRef = { id: 'stu-1' };
    const classRef = { id: 'class-1' };
    const receiptRef = { id: 'receipt-1' };
    const pendingPaymentDoc = makeDoc(
      {
        parentUid: 'parent-uid',
        studentId: 'stu-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        orderCode: 2605160001,
        amount: 2000,
        paymentLinkId: 'link-1',
        status: 'pending',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paidPaymentDoc = makeDoc(
      {
        parentUid: 'parent-uid',
        studentId: 'stu-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        orderCode: 2605160001,
        amount: 2000,
        paymentLinkId: 'link-1',
        status: 'paid',
        receiptId: 'receipt-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    paymentRef.get = vi.fn().mockResolvedValue(paidPaymentDoc);
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [pendingPaymentDoc] }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return pendingPaymentDoc;
        if (target === ledgerRef) return makeDoc({ amount: 2000, paidTotal: 0, discountTotal: 0 });
        if (target === studentRef) return makeDoc({ name: 'Student A', contact: '0384072314' });
        if (target === classRef) return makeDoc({ name: 'Class A' });
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ studentId: 'stu-1' })),
            })),
          };
        }
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockResolvedValue({
          id: 'link-1',
          orderCode: 2605160001,
          amount: 2000,
          amountPaid: 2000,
          amountRemaining: 0,
          status: 'PAID',
          createdAt: '2026-05-16T01:00:00.000Z',
          transactions: [
            {
              reference: 'TF123',
              amount: 2000,
              accountNumber: '12345678',
              description: 'Học phí 2605160001',
              transactionDateTime: '2026-05-16 01:00:00',
              virtualAccountName: null,
              virtualAccountNumber: null,
              counterAccountBankId: null,
              counterAccountBankName: null,
              counterAccountName: null,
              counterAccountNumber: null,
            },
          ],
          cancellationReason: null,
          canceledAt: null,
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'status', orderCode: '2605160001' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: 'paid',
      receiptId: 'receipt-1',
    });
    expect(tx.create).toHaveBeenCalledWith(
      receiptRef,
      expect.objectContaining({
        amountReceived: 2000,
        paymentConfirmationSource: 'gateway_status',
      })
    );
    expect(tx.update).toHaveBeenCalledWith(
      ledgerRef,
      expect.objectContaining({ paidTotal: 2000, status: 'paid' })
    );
    expect(tx.update).toHaveBeenCalledWith(
      paymentRef,
      expect.objectContaining({ status: 'paid', confirmationSource: 'gateway_status' })
    );
    expect(sendServerPaymentConfirmation).not.toHaveBeenCalled();
  });

  it('lets accounting refresh one pending payment by paymentRequestId', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'accounting-uid',
      role: 'accounting',
    } as any);
    const paymentRef: any = { id: 'payment-1' };
    const ledgerRef = { id: 'ledger-1' };
    const studentRef = { id: 'stu-1' };
    const classRef = { id: 'class-1' };
    const receiptRef = { id: 'receipt-1' };
    const pendingPaymentDoc = makeDoc(
      {
        studentId: 'stu-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        orderCode: 2605160001,
        amount: 2000,
        paymentLinkId: 'link-1',
        status: 'pending',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paidPaymentDoc = makeDoc(
      {
        studentId: 'stu-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        orderCode: 2605160001,
        amount: 2000,
        paymentLinkId: 'link-1',
        status: 'paid',
        receiptId: 'receipt-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    paymentRef.get = vi.fn().mockResolvedValue(paidPaymentDoc);
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return pendingPaymentDoc;
        if (target === ledgerRef) return makeDoc({ amount: 2000, paidTotal: 0, discountTotal: 0 });
        if (target === studentRef) return makeDoc({ name: 'Student A', contact: '0384072314' });
        if (target === classRef) return makeDoc({ name: 'Class A' });
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ role: 'accounting' })),
            })),
          };
        }
        if (name === 'payment_requests') {
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(pendingPaymentDoc) })),
          };
        }
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockResolvedValue({
          id: 'link-1',
          orderCode: 2605160001,
          amount: 2000,
          amountPaid: 2000,
          amountRemaining: 0,
          status: 'PAID',
          transactions: [
            { reference: 'TF123', amount: 2000, transactionDateTime: '2026-05-16 01:00:00' },
          ],
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'status', paymentRequestId: 'payment-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'paid', receiptId: 'receipt-1' });
    expect(tx.create).toHaveBeenCalledWith(
      receiptRef,
      expect.objectContaining({ amountReceived: 2000, paymentConfirmationSource: 'gateway_status' })
    );
  });

  it('adds gateway payments to the existing invoice paid total', async () => {
    const paymentRef: any = { id: 'payment-1' };
    const ledgerRef = { id: 'ledger-1' };
    const studentRef = { id: 'stu-1' };
    const classRef = { id: 'class-1' };
    const receiptRef = { id: 'receipt-1' };
    const invoiceRef = { id: 'invoice-1' };
    const pendingPaymentDoc = makeDoc(
      {
        parentUid: 'parent-uid',
        studentId: 'stu-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        invoiceId: 'invoice-1',
        invoiceNo: 'INV-2605160001',
        invoiceAmountSnapshot: 300000,
        orderCode: 2605160001,
        amount: 200000,
        paymentLinkId: 'link-1',
        status: 'pending',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paidPaymentDoc = makeDoc(
      {
        parentUid: 'parent-uid',
        studentId: 'stu-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        invoiceId: 'invoice-1',
        invoiceNo: 'INV-2605160001',
        invoiceAmountSnapshot: 300000,
        orderCode: 2605160001,
        amount: 200000,
        paymentLinkId: 'link-1',
        status: 'paid',
        receiptId: 'receipt-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    paymentRef.get = vi.fn().mockResolvedValue(paidPaymentDoc);
    const paymentQuery: any = {
      limit: vi.fn(() => paymentQuery),
      get: vi.fn().mockResolvedValue({ empty: false, docs: [pendingPaymentDoc] }),
    };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return pendingPaymentDoc;
        if (target === ledgerRef)
          return makeDoc({ amount: 300000, paidTotal: 100000, discountTotal: 0 });
        if (target === studentRef) return makeDoc({ name: 'Student A', contact: '0384072314' });
        if (target === classRef) return makeDoc({ name: 'Class A' });
        if (target === invoiceRef) return makeDoc({ amountPaid: 100000 });
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ studentId: 'stu-1' })),
            })),
          };
        }
        if (name === 'payment_requests') return { where: vi.fn(() => paymentQuery) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'invoices') return { doc: vi.fn(() => invoiceRef) };
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockResolvedValue({
          id: 'link-1',
          orderCode: 2605160001,
          amount: 200000,
          amountPaid: 200000,
          amountRemaining: 0,
          status: 'PAID',
          createdAt: '2026-05-16T01:00:00.000Z',
          transactions: [
            {
              reference: 'TF123',
              amount: 200000,
              transactionDateTime: '2026-05-16 01:00:00',
            },
          ],
        }),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'status', orderCode: '2605160001' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(tx.update).toHaveBeenCalledWith(
      invoiceRef,
      expect.objectContaining({
        amountPaid: 300000,
      })
    );
  });

  it('approves needs_review payment and creates receipt', async () => {
    const paymentRef = { id: 'payment-1', get: vi.fn(), update: vi.fn(), set: vi.fn() };
    const paymentDoc = makeDoc(
      {
        orderCode: 2605160001,
        amount: 500000,
        status: 'needs_review',
        paymentLinkId: 'link-1',
        ledgerId: 'ledger-1',
        studentId: 'stu-1',
        classId: 'class-1',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    paymentRef.get.mockResolvedValue(paymentDoc);
    const ledgerRef = { id: 'ledger-1' };
    const studentRef = { id: 'stu-1' };
    const classRef = { id: 'class-1' };
    const receiptRef = { id: 'receipt-1' };
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return paymentDoc;
        if (target === ledgerRef)
          return makeDoc({ amount: 700000, paidTotal: 200000, discountTotal: 0 });
        if (target === studentRef) return makeDoc({ name: 'Student A', contact: '0384072314' });
        if (target === classRef)
          return makeDoc({ name: 'Class A', startDate: '2026-01-01', endDate: '2026-06-01' });
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return { doc: vi.fn(() => paymentRef) };
        if (name === 'course_fee_ledgers') return { doc: vi.fn(() => ledgerRef) };
        if (name === 'students') return { doc: vi.fn(() => studentRef) };
        if (name === 'classes') return { doc: vi.fn(() => classRef) };
        if (name === 'receipts') return { doc: vi.fn(() => receiptRef) };
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ displayName: 'Admin' })),
            })),
          };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockResolvedValue({
          id: 'link-1',
          orderCode: 2605160001,
          amount: 500000,
          amountPaid: 500000,
          amountRemaining: 0,
          status: 'PAID',
          createdAt: '2026-05-16T01:00:00.000Z',
          transactions: [
            {
              reference: 'BANK-2605160001',
              amount: 500000,
              transactionDateTime: '2026-05-16 01:00:00',
            },
          ],
        }),
      },
      webhooks: { verify: vi.fn() },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'resolve-review' },
        body: {
          paymentRequestId: 'payment-1',
          decision: 'approve',
          reason: 'Verified via bank statement',
          gatewayAmount: 500000,
          gatewayReference: 'BANK-2605160001',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      action: 'approved',
      receiptId: 'receipt-1',
    });
    expect(tx.create).toHaveBeenCalled();
    expect(sendServerPaymentConfirmation).not.toHaveBeenCalled();
  });

  it('rejects needs_review payment', async () => {
    const paymentDoc = makeDoc({ status: 'needs_review', amount: 500000 }, { id: 'payment-1' });
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests')
          return {
            doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(paymentDoc), update: vi.fn() })),
          };
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ displayName: 'Admin' })),
            })),
          };
        }
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'resolve-review' },
        body: { paymentRequestId: 'payment-1', decision: 'reject', reason: 'Duplicate payment' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, action: 'rejected' });
  });

  it('stores a generic review reason when payOS verification fails', async () => {
    const paymentRef = { id: 'payment-1', get: vi.fn(), update: vi.fn(), set: vi.fn() };
    const paymentDoc = makeDoc(
      { status: 'needs_review', amount: 500000, orderCode: 2605160001 },
      { id: 'payment-1', ref: paymentRef }
    );
    paymentRef.get.mockResolvedValue(paymentDoc);
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return { doc: vi.fn(() => paymentRef) };
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(makeDoc({ displayName: 'Admin' })),
            })),
          };
        }
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@test.com',
    } as any);
    vi.mocked(getPayOSClient).mockReturnValue({
      paymentRequests: {
        get: vi.fn().mockRejectedValue(new Error('PAYOS_CLIENT_SECRET=secret-key socket trace')),
      },
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'resolve-review' },
        body: { paymentRequestId: 'payment-1', decision: 'approve' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(502);
    expect(paymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ reviewReason: 'Failed to verify payment with payOS' })
    );
    expect(JSON.stringify(paymentRef.update.mock.calls)).not.toContain('secret-key');
    expect(JSON.stringify(paymentRef.update.mock.calls)).not.toContain('socket trace');
  });

  it('does not reserve a receipt number when a confirmed payment is already paid', async () => {
    const paymentRef: any = { id: 'payment-1' };
    const paymentDoc = makeDoc(
      {
        status: 'pending',
        receiptId: '',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const paidPaymentDoc = makeDoc(
      {
        status: 'paid',
        receiptId: 'receipt-existing',
      },
      { id: 'payment-1', ref: paymentRef }
    );
    const tx = {
      get: vi.fn(async (target: any) => {
        if (target === paymentRef) return paidPaymentDoc;
        return makeDoc({}, { exists: false });
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    const db: any = {
      runTransaction: vi.fn(async (callback: any) => callback(tx)),
    };

    const result = await postConfirmedPayment(
      db,
      paymentDoc as any,
      {
        source: 'gateway_reconcile',
        orderCode: 2605160001,
        amount: 500000,
        paymentLinkId: 'link-1',
        reference: 'TF123',
        transactionDateTime: '2026-05-16 01:00:00',
      },
      { actorId: 'job:test-payos-reconcile', operation: 'payments:reconcile' }
    );

    expect(result).toMatchObject({
      alreadyPaid: true,
      receiptId: 'receipt-existing',
      needsReview: false,
    });
    expect(getNextReceiptNumber).not.toHaveBeenCalled();
    expect(reserveNextCounterSequence).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('rejects resolution on non-needs_review payment', async () => {
    const paymentDoc = makeDoc({ status: 'paid', amount: 500000 }, { id: 'payment-1' });
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests')
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(paymentDoc) })) };
        return {};
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid' } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'resolve-review' },
        body: { paymentRequestId: 'payment-1', decision: 'approve', reason: 'test' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('caches payment health counts across repeated list refreshes', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'accounting-uid' } as any,
      context: {
        uid: 'accounting-uid',
        role: 'accounting',
        name: 'Accounting User',
      },
    });

    const healthCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) });
    const paymentListQuery: any = {
      orderBy: vi.fn(() => paymentListQuery),
      limit: vi.fn(() => paymentListQuery),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const countQuery: any = {
      where: vi.fn(() => countQuery),
      count: vi.fn(() => ({
        get: healthCountGet,
      })),
    };
    const paymentCollection = {
      doc: vi.fn(),
      orderBy: vi.fn(() => paymentListQuery),
      where: vi.fn(() => countQuery),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentCollection;
        if (name === 'webhook_events') return countQuery;
        return { doc: vi.fn() };
      }),
      getAll: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token' },
      query: { action: 'list' },
    };
    await handler(req as any, mockRes() as any);
    await handler(req as any, mockRes() as any);

    expect(healthCountGet.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('skips receipt enrichment when includeReceiptStatus is false', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'accounting-uid' } as any,
      context: { uid: 'accounting-uid', role: 'accounting', name: 'Accounting User' },
    });
    const getAll = vi.fn().mockResolvedValue([]);
    const paymentListQuery: any = {
      orderBy: vi.fn(() => paymentListQuery),
      limit: vi.fn(() => paymentListQuery),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    };
    const countQuery: any = {
      where: vi.fn(() => countQuery),
      count: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
      })),
    };
    const paymentCollection = {
      doc: vi.fn(),
      orderBy: vi.fn(() => paymentListQuery),
      where: vi.fn(() => countQuery),
    };
    const db: any = {
      collection: vi.fn((name: string) => {
        if (name === 'payment_requests') return paymentCollection;
        if (name === 'webhook_events') return countQuery;
        return { doc: vi.fn() };
      }),
      getAll,
    };
    vi.mocked(getDb).mockReturnValue(db as any);

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token' },
      query: { action: 'list', includeReceiptStatus: 'false' },
    };
    await handler(req as any, mockRes() as any);

    expect(getAll).not.toHaveBeenCalled();
  });
});
