import { describe, expect, it, vi } from 'vitest';
import { readFinanceResource } from './readers.js';
import { flattenStudentReceiptRows } from './utils.js';

type Row = { id: string; data: Record<string, unknown> };

function queryDoc(row: Row) {
  return {
    id: row.id,
    exists: true,
    data: () => row.data,
  } as unknown as AppDocumentStore.QueryDocumentSnapshot;
}

function financeReceiptDb(
  rows: Row[],
  whereSpy: (field: string, operator: string, value: unknown) => unknown
) {
  class FakeQuery {
    filters: Array<[string, string, unknown]> = [];
    order: Array<[string, string | undefined]> = [];
    take = Number.POSITIVE_INFINITY;
    after = '';

    where(field: string, operator: string, value: unknown) {
      whereSpy(field, operator, value);
      this.filters.push([field, operator, value]);
      return this;
    }

    orderBy(field: string, direction?: string) {
      this.order.push([field, direction]);
      return this;
    }

    limit(value: number) {
      this.take = value;
      return this;
    }

    startAfter(cursor: { id: string }) {
      this.after = cursor.id;
      return this;
    }

    async get() {
      let result = rows.filter((row) =>
        this.filters.every(([field, operator, value]) => {
          if (operator === 'array-contains') {
            return Array.isArray(row.data[field]) && row.data[field].includes(value);
          }
          return row.data[field] === value;
        })
      );
      result = result.sort((a, b) =>
        String(b.data.createdAt || '').localeCompare(String(a.data.createdAt || ''))
      );
      if (this.after) {
        const index = result.findIndex((row) => row.id === this.after);
        result = index >= 0 ? result.slice(index + 1) : result;
      }
      return { docs: result.slice(0, this.take).map(queryDoc) };
    }
  }

  return {
    collection: () => {
      const query = new FakeQuery();
      return Object.assign(query, {
        doc: (id: string) => ({
          get: async () => {
            const row = rows.find((item) => item.id === id);
            return row
              ? queryDoc(row)
              : ({
                  id,
                  exists: false,
                  data: () => undefined,
                } as unknown as AppDocumentStore.DocumentSnapshot);
          },
        }),
      });
    },
  } as unknown as AppDocumentStore.DocumentStore;
}

describe('readFinanceResource receipt class filtering', () => {
  it('flattens a v2 receipt into one receipt row per matching ledger', () => {
    const rows = flattenStudentReceiptRows(
      [
        {
          id: 'r1',
          data: {
            receiptNo: 'PT-260727-001',
            receivedDate: '2026-07-27',
            paymentMethod: 'cash',
            status: 'posted',
            allocations: [
              { ledgerId: 'l1', classId: 'c1', amount: 300 },
              { ledgerId: 'l2', classId: 'c2', amount: 200 },
            ],
          },
        },
      ],
      new Set(['l1', 'l2'])
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'r1:l1', ledgerId: 'l1', amount: 300 }),
        expect.objectContaining({ id: 'r1:l2', ledgerId: 'l2', amount: 200 }),
      ])
    );
  });

  it('filters on classIds before pagination and preserves server cursor metadata', async () => {
    const whereSpy = vi.fn();
    const db = financeReceiptDb(
      [
        {
          id: 'legacy',
          data: {
            classId: 'c1',
            classIds: ['c1'],
            createdAt: '2026-07-28T03:00:00.000Z',
          },
        },
        {
          id: 'v2-new',
          data: {
            flowVersion: 'wallet-manual-v2',
            classId: 'c1',
            classIds: ['c1', 'c2'],
            createdAt: '2026-07-28T02:00:00.000Z',
          },
        },
        {
          id: 'v2-old',
          data: {
            flowVersion: 'wallet-manual-v2',
            classId: 'c2',
            classIds: ['c2'],
            createdAt: '2026-07-28T01:00:00.000Z',
          },
        },
      ],
      whereSpy
    );

    const result = await readFinanceResource(
      db,
      { uid: 'accounting-1', role: 'accounting' } as never,
      { query: { classId: 'c2', limit: '1' } } as never,
      'receipts'
    );

    const receipts = result.receipts as Array<{ id: string }>;
    expect(receipts.map((row) => row.id)).toEqual(['v2-new']);
    expect(result.page).toMatchObject({
      nextCursor: 'v2-new',
      hasMore: true,
    });
    expect(whereSpy).toHaveBeenCalledWith('classIds', 'array-contains', 'c2');
    expect(whereSpy).not.toHaveBeenCalledWith('classId', '==', 'c2');
  });
});
