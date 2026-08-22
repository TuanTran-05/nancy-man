import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  postWalletManualReceipt,
  voidWalletManualReceipt,
} from './manualReceiptWallet';

vi.mock('../../lib/documentStore/counterSequence.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/documentStore/counterSequence.js')>();
  return {
    ...actual,
    reserveNextCounterSequence: vi.fn().mockResolvedValue(1),
  };
});

type StoredData = Record<string, any>;
type DocRef = { kind: 'doc'; path: string; id: string };
type QueryRef = {
  kind: 'query';
  collectionName: string;
  filters: Array<{ field: string; op: string; value: unknown }>;
  where: (field: string, op: string, value: unknown) => QueryRef;
};

function makeDb(seed: Record<string, StoredData>) {
  const docs = new Map<string, StoredData>(
    Object.entries(seed).map(([path, data]) => [path, structuredClone(data)])
  );
  let autoId = 0;

  const docRef = (collectionName: string, id: string): DocRef => ({
    kind: 'doc',
    path: `${collectionName}/${id}`,
    id,
  });
  const docSnap = (ref: DocRef) => ({
    exists: docs.has(ref.path),
    id: ref.id,
    ref,
    data: () => docs.get(ref.path),
  });
  const makeQuery = (
    collectionName: string,
    filters: QueryRef['filters'] = []
  ): QueryRef => {
    const query: QueryRef = {
      kind: 'query',
      collectionName,
      filters,
      where(field, op, value) {
        return makeQuery(collectionName, [...filters, { field, op, value }]);
      },
    };
    return query;
  };
  const matches = (
    data: StoredData,
    filter: { field: string; op: string; value: unknown }
  ) => {
    if (filter.op === '==') return data[filter.field] === filter.value;
    if (filter.op === 'in') {
      return Array.isArray(filter.value) && filter.value.includes(data[filter.field]);
    }
    throw new Error(`Unsupported fake query operator: ${filter.op}`);
  };
  const querySnap = (query: QueryRef) => {
    const rows = [...docs.entries()]
      .filter(([path]) => path.startsWith(`${query.collectionName}/`))
      .filter(([, data]) => query.filters.every((filter) => matches(data, filter)))
      .map(([path, data]) => {
        const id = path.slice(query.collectionName.length + 1);
        const ref = docRef(query.collectionName, id);
        return { id, ref, data: () => data };
      });
    return { docs: rows, size: rows.length, empty: rows.length === 0 };
  };

  const db = {
    docs,
    collection(collectionName: string) {
      return {
        doc(id?: string) {
          return docRef(collectionName, id || `auto-${++autoId}`);
        },
        where(field: string, op: string, value: unknown) {
          return makeQuery(collectionName).where(field, op, value);
        },
      };
    },
    async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      const tx = {
        get: async (target: DocRef | QueryRef) =>
          target.kind === 'doc' ? docSnap(target) : querySnap(target),
        set: (ref: DocRef, data: StoredData) => {
          docs.set(ref.path, structuredClone(data));
        },
        create: (ref: DocRef, data: StoredData) => {
          if (docs.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
          docs.set(ref.path, structuredClone(data));
        },
        update: (ref: DocRef, data: StoredData) => {
          docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...structuredClone(data) });
        },
      };
      return callback(tx);
    },
  };
  return db as any;
}

function postInput(db: AppDocumentStore.DocumentStore, overrides: Record<string, unknown> = {}) {
  return {
    db,
    data: {
      flowVersion: 'wallet-manual-v2' as const,
      idempotencyKey: 'r-key',
      studentId: 's1',
      amountReceived: 2_000,
      allocations: [
        { ledgerId: 'l1', amount: 900 },
        { ledgerId: 'l2', amount: 600 },
      ],
      paymentMethod: 'cash',
      receivedDate: '2026-07-27',
      note: '',
      ...overrides,
    },
    uid: 'u1',
    userInfo: { role: 'accounting', name: 'Kế toán A' },
  };
}

let testDb: ReturnType<typeof makeDb>;

beforeEach(() => {
  testDb = makeDb({
    'students/s1': { name: 'Nguyễn An', classId: 'c1', walletBalance: 500 },
    'course_fee_ledgers/l1': {
      studentId: 's1',
      classId: 'c1',
      amount: 1_000,
      paidTotal: 100,
      discountTotal: 0,
      status: 'partial',
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

describe('postWalletManualReceipt', () => {
  it('posts receipt, deposit, two allocations, ledgers, and wallet atomically', async () => {
    const result = await postWalletManualReceipt(postInput(testDb));

    expect(result.response.newBalance).toBe(1_000);
    expect(testDb.docs.get('students/s1')).toMatchObject({ walletBalance: 1_000 });
    expect(testDb.docs.get('course_fee_ledgers/l1')).toMatchObject({
      paidTotal: 1_000,
      status: 'paid',
    });
    expect(testDb.docs.get('course_fee_ledgers/l2')).toMatchObject({
      paidTotal: 600,
      status: 'partial',
    });
    const walletRows = [...testDb.docs.entries()]
      .filter(([path]) => path.startsWith('wallet_transactions/'))
      .map(([, data]) => data);
    expect(walletRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'deposit', amount: 2_000, groupSequence: 0 }),
        expect.objectContaining({ type: 'allocation', ledgerId: 'l1', amount: 900 }),
        expect.objectContaining({ type: 'allocation', ledgerId: 'l2', amount: 600 }),
      ])
    );
  });

  it('replays the same idempotency key without a second money movement', async () => {
    const first = await postWalletManualReceipt(postInput(testDb));
    const second = await postWalletManualReceipt(postInput(testDb));
    expect(second.replay).toBe(true);
    expect(second.response).toEqual(first.response);
    expect(testDb.docs.get('students/s1')?.walletBalance).toBe(1_000);
    expect(
      [...testDb.docs.keys()].filter((path) => path.startsWith('wallet_transactions/'))
    ).toHaveLength(3);
  });

  it('rejects another-student ledgers and a changed remaining debt', async () => {
    testDb.docs.set('course_fee_ledgers/other', {
      studentId: 's2',
      classId: 'c3',
      amount: 1_000,
      paidTotal: 0,
      discountTotal: 0,
    });
    await expect(
      postWalletManualReceipt(
        postInput(testDb, {
          allocations: [{ ledgerId: 'other', amount: 100 }],
        })
      )
    ).rejects.toMatchObject({ errorCode: 'wallet_ledger_wrong_student' });

    testDb.docs.set('course_fee_ledgers/l1', {
      studentId: 's1',
      classId: 'c1',
      amount: 1_000,
      paidTotal: 950,
      discountTotal: 0,
    });
    await expect(
      postWalletManualReceipt(
        postInput(testDb, {
          idempotencyKey: 'changed-ledger',
          allocations: [{ ledgerId: 'l1', amount: 100 }],
        })
      )
    ).rejects.toMatchObject({ errorCode: 'wallet_allocation_exceeds_debt' });
  });

  it('rejects cross-flow idempotency key reuse', async () => {
    testDb.docs.set('finance_idempotency_keys/u1:r-key', {
      type: 'expense-create-and-post',
      response: { success: true, id: 'expense-1' },
    });
    await expect(postWalletManualReceipt(postInput(testDb))).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'idempotency_key_conflict',
    });
  });

  it('stales active PayOS requests for every selected ledger', async () => {
    testDb.docs.set('payment_requests/p1', {
      ledgerId: 'l1',
      status: 'creating_gateway_session',
    });
    testDb.docs.set('payment_requests/p2', { ledgerId: 'l2', status: 'pending' });
    testDb.docs.set('payment_requests/p3', { ledgerId: 'l2', status: 'paid' });

    await postWalletManualReceipt(postInput(testDb));

    expect(testDb.docs.get('payment_requests/p1')).toMatchObject({ status: 'stale' });
    expect(testDb.docs.get('payment_requests/p2')).toMatchObject({ status: 'stale' });
    expect(testDb.docs.get('payment_requests/p3')).toMatchObject({ status: 'paid' });
  });

  it('posts a full waiver without creating a wallet transaction', async () => {
    const result = await postWalletManualReceipt(
      postInput(testDb, {
        amountReceived: 0,
        allocations: [{ ledgerId: 'l2', amount: 0, discountType: 'full_waiver' }],
      })
    );
    expect(result.response.newBalance).toBe(500);
    expect(testDb.docs.get('course_fee_ledgers/l2')).toMatchObject({
      paidTotal: 0,
      discountTotal: 2_000,
      status: 'waived',
    });
    expect(
      [...testDb.docs.keys()].filter((path) => path.startsWith('wallet_transactions/'))
    ).toHaveLength(0);
  });
});

describe('voidWalletManualReceipt', () => {
  it('voids the full receipt group and restores every ledger', async () => {
    const posted = await postWalletManualReceipt(postInput(testDb));
    const result = await voidWalletManualReceipt({
      db: testDb,
      receiptId: posted.response.id,
      idempotencyKey: 'void-key',
      reason: 'Thu nhầm học sinh',
      uid: 'u1',
      userInfo: { role: 'accounting', name: 'Kế toán A' },
    });
    expect(result.response.newBalance).toBe(500);
    expect(testDb.docs.get('course_fee_ledgers/l1')?.paidTotal).toBe(100);
    expect(testDb.docs.get('course_fee_ledgers/l2')?.paidTotal).toBe(0);
    expect(testDb.docs.get(`receipts/${posted.response.id}`)).toMatchObject({
      status: 'void',
      voidReason: 'Thu nhầm học sinh',
    });
  });

  it('blocks a void after dependent wallet spending', async () => {
    const posted = await postWalletManualReceipt(postInput(testDb));
    testDb.docs.set('students/s1', {
      ...testDb.docs.get('students/s1'),
      walletBalance: 0,
    });
    await expect(
      voidWalletManualReceipt({
        db: testDb,
        receiptId: posted.response.id,
        idempotencyKey: 'void-dependent',
        reason: 'Thu nhầm',
        uid: 'u1',
        userInfo: { role: 'accounting', name: 'Kế toán A' },
      })
    ).rejects.toMatchObject({ errorCode: 'wallet_void_has_dependencies' });
  });

  it('restores discount and sibling totals exactly and replays void idempotently', async () => {
    testDb.docs.set('students/s1', {
      ...testDb.docs.get('students/s1'),
      siblingGroupId: 'g1',
    });
    testDb.docs.set('students/sibling', {
      name: 'Sibling',
      studentLifecycle: 'enrolled',
      siblingGroupId: 'g1',
    });
    testDb.docs.set('course_fee_ledgers/l1', {
      studentId: 's1',
      classId: 'c1',
      amount: 1_000,
      paidTotal: 0,
      discountTotal: 0,
      siblingDiscountTotal: 0,
      status: 'unpaid',
    });
    const posted = await postWalletManualReceipt(
      postInput(testDb, {
        amountReceived: 900,
        allocations: [{ ledgerId: 'l1', amount: 900, siblingDiscount: true }],
      })
    );
    expect(testDb.docs.get('course_fee_ledgers/l1')).toMatchObject({
      paidTotal: 900,
      discountTotal: 100,
      siblingDiscountTotal: 100,
    });

    const input = {
      db: testDb,
      receiptId: posted.response.id,
      idempotencyKey: 'void-discount',
      reason: 'Thu nhầm',
      uid: 'u1',
      userInfo: { role: 'accounting', name: 'Kế toán A' },
    };
    const first = await voidWalletManualReceipt(input);
    const second = await voidWalletManualReceipt(input);
    expect(second).toMatchObject({ replay: true, response: first.response });
    expect(testDb.docs.get('course_fee_ledgers/l1')).toMatchObject({
      paidTotal: 0,
      discountTotal: 0,
      siblingDiscountTotal: 0,
      status: 'unpaid',
    });
  });
});
