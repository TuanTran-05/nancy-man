import { describe, expect, it } from 'vitest';
import {
  FinanceRepository,
  MAX_REPORT_DOCS_PER_COLLECTION,
  ReportRangeTooLargeError,
} from './financeRepository.js';

type Doc = { id: string; data: () => Record<string, unknown> };

function fakeCollection(docsByField: {
  monthDocs?: Record<string, unknown>[];
  termStartDocs?: Record<string, unknown>[];
  emptyTermStartDocs?: Record<string, unknown>[];
  emptyTermEndDocs?: Record<string, unknown>[];
}) {
  const makeSnap = (rows: Record<string, unknown>[]) => ({
    size: rows.length,
    docs: rows.map((r, i): Doc => ({ id: String(r.id ?? `d${i}`), data: () => r })),
  });
  // Route each query to its doc set: month `in`, termStart range, and orphan `termStart == ''`.
  const pick = (field: string, op: string, value: unknown) => {
    if (field === 'month') return docsByField.monthDocs ?? [];
    if (field === 'termStart' && op === '==' && value === '')
      return docsByField.emptyTermStartDocs ?? [];
    if (field === 'termEnd' && op === '==' && value === '')
      return docsByField.emptyTermEndDocs ?? [];
    return docsByField.termStartDocs ?? [];
  };
  return {
    where(field: string, op: string, value: unknown) {
      const rows = pick(field, op, value);
      const q: any = {
        where: () => q,
        orderBy: () => q,
        limit: () => q,
        get: async () => makeSnap(rows),
      };
      return q;
    },
  };
}

function fakeDb(docsByField: Parameters<typeof fakeCollection>[0]) {
  return { collection: () => fakeCollection(docsByField) } as any;
}

describe('FinanceRepository.listLedgersByCohortMonths', () => {
  it('unions month and overlapping term queries and dedupes by id', async () => {
    const repo = new FinanceRepository(
      fakeDb({
        monthDocs: [{ id: 'm1', month: '2026-04', amount: 1000 }],
        termStartDocs: [
          { id: 'c1', termStart: '2026-04-02', amount: 2000 },
          { id: 'm1', month: '2026-04', amount: 1000 }, // duplicate id, should collapse
        ],
      })
    );
    const rows = await repo.listLedgersByCohortMonths(['2026-04']);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(['c1', 'm1']);
  });

  it('returns empty for an empty month list without querying', async () => {
    const repo = new FinanceRepository(fakeDb({ monthDocs: [], termStartDocs: [] }));
    expect(await repo.listLedgersByCohortMonths([])).toEqual([]);
  });

  it('normalizes a DocumentStore Timestamp createdAt to a string', async () => {
    const ts = { toDate: () => new Date('2026-02-20T00:00:00.000Z') };
    const repo = new FinanceRepository(
      fakeDb({
        monthDocs: [],
        termStartDocs: [{ id: 'c1', termStart: '2026-04-02', createdAt: ts }],
      })
    );
    const [row] = await repo.listLedgersByCohortMonths(['2026-04']);
    expect(typeof row.createdAt).toBe('string');
    expect(row.createdAt).toContain('2026-02-20');
  });

  it('includes orphan course ledgers with an empty termStart (equality query)', async () => {
    // Class had no startDate -> generator wrote termStart: '' -> missed by both the month `in`
    // and the termStart range queries. The `termStart == ''` query must recover it.
    const ts = { toDate: () => new Date('2026-04-15T00:00:00.000Z') };
    const repo = new FinanceRepository(
      fakeDb({
        monthDocs: [],
        termStartDocs: [],
        emptyTermStartDocs: [
          { id: 'orphan1', termStart: '', periodType: 'course', createdAt: ts, amount: 500 },
        ],
      })
    );
    const rows = await repo.listLedgersByCohortMonths(['2026-04']);
    expect(rows.map((r) => r.id)).toContain('orphan1');
  });

  it('includes incomplete course ledgers with an empty termEnd', async () => {
    const repo = new FinanceRepository(
      fakeDb({
        monthDocs: [],
        termStartDocs: [],
        emptyTermStartDocs: [],
        emptyTermEndDocs: [
          {
            id: 'missing-end',
            termStart: '2026-04-15',
            termEnd: '',
            periodType: 'course',
          },
        ],
      })
    );
    const rows = await repo.listLedgersByCohortMonths(['2026-04']);
    expect(rows.map((r) => r.id)).toContain('missing-end');
  });

  it('throws only when the MERGED result exceeds the doc cap (disjoint queries)', async () => {
    // Each query stays under the cap; only the union (cap+1 distinct ids) exceeds it.
    const n1 = Math.ceil((MAX_REPORT_DOCS_PER_COLLECTION + 1) / 2);
    const n2 = MAX_REPORT_DOCS_PER_COLLECTION + 1 - n1;
    const monthDocs = Array.from({ length: n1 }, (_, i) => ({ id: `m${i}`, month: '2026-04' }));
    const termStartDocs = Array.from({ length: n2 }, (_, i) => ({
      id: `c${i}`,
      termStart: '2026-04-02',
    }));
    const repo = new FinanceRepository(fakeDb({ monthDocs, termStartDocs }));
    await expect(repo.listLedgersByCohortMonths(['2026-04'])).rejects.toBeInstanceOf(
      ReportRangeTooLargeError
    );
  });
});

describe('FinanceRepository transaction detail pages', () => {
  it('pages posted receipts newest-first and returns aggregate count and sum', async () => {
    const trace: Array<[string, unknown[]]> = [];
    const rows = [
      { id: 'r3', receivedDate: '2026-07-30', amountReceived: 300 },
      { id: 'r2', receivedDate: '2026-07-29', amountReceived: 200 },
      { id: 'r1', receivedDate: '2026-07-28', amountReceived: 100 },
    ];
    const makeDoc = (row: (typeof rows)[number]) => ({ id: row.id, data: () => row });
    const query: any = {
      where: (...args: unknown[]) => {
        trace.push(['where', args]);
        return query;
      },
      orderBy: (...args: unknown[]) => {
        trace.push(['orderBy', args]);
        return query;
      },
      startAfter: (...args: unknown[]) => {
        trace.push(['startAfter', args]);
        return query;
      },
      limit: (...args: unknown[]) => {
        trace.push(['limit', args]);
        return query;
      },
      aggregate: () => ({
        get: async () => ({ data: () => ({ totalCount: 3, totalAmount: 600 }) }),
      }),
      get: async () => ({ docs: rows.map(makeDoc), size: rows.length }),
    };
    const repo = new FinanceRepository({ collection: () => query } as any);

    const page = await repo.listPostedReceiptDetailsPage({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      pageSize: 2,
      cursor: { date: '2026-07-31', id: 'r4' },
    });

    expect(page.rows.map((row) => row.id)).toEqual(['r3', 'r2']);
    expect(page.totalCount).toBe(3);
    expect(page.totalAmount).toBe(600);
    expect(page.nextCursor).toEqual({ date: '2026-07-29', id: 'r2' });
    expect(trace).toEqual(
      expect.arrayContaining([
        ['where', ['status', '==', 'posted']],
        ['where', ['receivedDate', '>=', '2026-07-01']],
        ['where', ['receivedDate', '<=', `2026-07-31${'\uf8ff'}`]],
        ['orderBy', ['receivedDate', 'desc']],
        ['startAfter', ['2026-07-31', 'r4']],
        ['limit', [3]],
      ])
    );
    const orderCalls = trace.filter(([name]) => name === 'orderBy');
    expect(orderCalls).toHaveLength(2);
    expect(orderCalls[1][1][1]).toBe('desc');
  });

  it('pages expenses using paidDate and expense amount', async () => {
    const calls: string[] = [];
    const query: any = {
      where: (field: string) => {
        calls.push(field);
        return query;
      },
      orderBy: () => query,
      limit: () => query,
      aggregate: () => ({
        get: async () => ({ data: () => ({ totalCount: 1, totalAmount: 450_000 }) }),
      }),
      get: async () => ({
        docs: [{ id: 'e1', data: () => ({ paidDate: '2026-07-15', amount: 450_000 }) }],
        size: 1,
      }),
    };
    const repo = new FinanceRepository({ collection: () => query } as any);
    const page = await repo.listPostedExpenseDetailsPage({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      pageSize: 25,
      cursor: null,
    });

    expect(calls).toContain('paidDate');
    expect(page).toMatchObject({ totalCount: 1, totalAmount: 450_000, nextCursor: null });
    expect(page.rows[0]).toMatchObject({ id: 'e1', amount: 450_000 });
  });

  it('batch loads ledgers and classes by id without returning missing documents', async () => {
    const refs: Array<{ collection: string; id: string }> = [];
    const db = {
      collection: (collection: string) => ({
        doc: (id: string) => {
          refs.push({ collection, id });
          return { collection, id };
        },
      }),
      getAll: async (...requestedRefs: Array<{ collection: string; id: string }>) =>
        requestedRefs.map((ref) => ({
          id: ref.id,
          exists: ref.id !== 'missing',
          data: () =>
            ref.collection === 'classes'
              ? { name: `Class ${ref.id}` }
              : { amount: 1_000_000, paidTotal: 250_000, classId: 'c1' },
        })),
    };
    const repo = new FinanceRepository(db as any);

    await expect(repo.listLedgersByIds(['l1', 'missing', 'l1'])).resolves.toEqual([
      { id: 'l1', amount: 1_000_000, paidTotal: 250_000, classId: 'c1' },
    ]);
    await expect(repo.listClassesByIds(['c1', 'missing', 'c1'])).resolves.toEqual([
      { id: 'c1', className: 'Class c1' },
    ]);
    expect(refs).toEqual([
      { collection: 'course_fee_ledgers', id: 'l1' },
      { collection: 'course_fee_ledgers', id: 'missing' },
      { collection: 'classes', id: 'c1' },
      { collection: 'classes', id: 'missing' },
    ]);
  });

  it('includes the current student wallet balance in student lookups', async () => {
    const repo = new FinanceRepository({
      collection: () => ({
        doc: (id: string) => ({ id }),
      }),
      getAll: async (...refs: Array<{ id: string }>) =>
        refs.map((ref) => ({
          id: ref.id,
          exists: true,
          data: () => ({
            name: 'Nguyễn An',
            studentId: 'HS001',
            contact: '0901234567',
            walletBalance: 125_000,
          }),
        })),
    } as any);

    await expect(repo.listStudentsByIds(['s1'])).resolves.toEqual([
      {
        id: 's1',
        name: 'Nguyễn An',
        studentId: 'HS001',
        dob: undefined,
        contact: '0901234567',
        walletBalance: 125_000,
      },
    ]);
  });
});
