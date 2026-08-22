import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import type { ApiRequest } from '@/server/api/lib/http/types.js';
import type { UserContext } from '../../lib/auth/authz.js';
import { buildAccountingStudentSummary } from '../../lib/accounting/studentFinanceProjection.js';
import { readAccountingStudentFinanceWorkspace } from './accountingStudentFinance.js';

type Row = { id: string; data: Record<string, unknown> };

/**
 * A DocumentStore stub that actually applies `array-contains`, ordering and cursors, so the
 * test exercises what the real index can and cannot answer.
 */
function fakeSummaryQuery(rows: Row[]) {
  const makeDoc = (row: Row) => ({ id: row.id, exists: true, data: () => row.data });
  const build = (
    filters: Array<(row: Row) => boolean>,
    orderKeys: string[],
    max: number | null,
    after: string | null
  ): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op === 'array-contains') {
        return build(
          [
            ...filters,
            (row) => Array.isArray(row.data[field]) && (row.data[field] as unknown[]).includes(value),
          ],
          orderKeys,
          max,
          after
        );
      }
      if (op === 'not-in') {
        return build(
          [...filters, (row) => !(value as unknown[]).includes(row.data[field])],
          orderKeys,
          max,
          after
        );
      }
      return build([...filters, (row) => row.data[field] === value], orderKeys, max, after);
    },
    orderBy: (field: unknown) => build(filters, [...orderKeys, String(field)], max, after),
    limit: (value: number) => build(filters, orderKeys, value, after),
    startAfter: (doc: { id: string }) => build(filters, orderKeys, max, doc.id),
    get: async () => {
      let matched = rows.filter((row) => filters.every((filter) => filter(row)));
      matched = [...matched].sort((a, b) => a.id.localeCompare(b.id));
      if (after) matched = matched.slice(matched.findIndex((row) => row.id === after) + 1);
      if (max !== null) matched = matched.slice(0, max);
      return { docs: matched.map(makeDoc) };
    },
    doc: (id: string) => ({
      get: async () => {
        const row = rows.find((item) => item.id === id);
        return row ? makeDoc(row) : { id, exists: false, data: () => undefined };
      },
    }),
  });
  return build([], [], null, null);
}

function summaryRow(name: string, code: string): Row {
  const summary = buildAccountingStudentSummary({
    student: { id: code, name, studentId: code },
    enrollments: [],
    ledgers: [],
    today: '2026-08-04',
    sourceVersion: 3,
    rebuiltAt: '2026-08-04T00:00:00.000Z',
  });
  return { id: code, data: summary as unknown as Record<string, unknown> };
}

function fakeDb(rows: Row[], healthOverride: Record<string, unknown> = {}): DocumentStore {
  return {
    collection: (name: string) => {
      if (name === 'accounting_student_summaries') return fakeSummaryQuery(rows);
      if (name === 'accounting_student_summary_health') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                sourceVersion: 3,
                complete: true,
                repairBacklog: 0,
                eligibleCanonicalProfiles: rows.length,
                physicalStudentDocumentCount: rows.length,
                canonicalProfileCount: rows.length,
                aliasCount: 0,
                tombstoneCount: 0,
                aliasOrTombstoneSummaryCount: 0,
                orphanSummaryCount: 0,
                studentCount: rows.length,
                summaryCount: rows.length,
                ...healthOverride,
              }),
            }),
          }),
        };
      }
      return fakeSummaryQuery([]);
    },
  } as unknown as DocumentStore;
}

const ctx = { uid: 'acc-1', role: 'accounting', email: 'acc@test.com' } as unknown as UserContext;

const rows = [
  summaryRow('Nguyễn Văn An', 'HS001'),
  summaryRow('Nguyễn Thị Bình', 'HS002'),
  summaryRow('Trần Văn An', 'HS003'),
];

async function search(term: string) {
  const page = await readAccountingStudentFinanceWorkspace(fakeDb(rows), ctx, {
    query: { search: term },
  } as unknown as ApiRequest);
  return page.rows.map((row) => row.studentName);
}

describe('accounting student finance workspace search', () => {
  it('finds the student when the accountant pastes a full name with diacritics', async () => {
    expect(await search('Nguyễn Văn An')).toEqual(['Nguyễn Văn An']);
  });

  it('finds the student when the pasted name has no diacritics', async () => {
    expect(await search('Nguyen Van An')).toEqual(['Nguyễn Văn An']);
  });

  it('narrows a shared surname down to the matching student', async () => {
    expect(await search('Nguyễn Thị')).toEqual(['Nguyễn Thị Bình']);
  });

  it('keeps returning every student that matches a single word', async () => {
    expect(await search('Văn')).toEqual(['Nguyễn Văn An', 'Trần Văn An']);
  });

  it('finds the student by code regardless of case', async () => {
    expect(await search('hs002')).toEqual(['Nguyễn Thị Bình']);
  });

  it('returns nothing for a name that is not in the list', async () => {
    expect(await search('Lê Văn Cường')).toEqual([]);
  });

  it('reports no further pages once the filtered rows are exhausted', async () => {
    const page = await readAccountingStudentFinanceWorkspace(fakeDb(rows), ctx, {
      query: { search: 'Nguyễn Văn An' },
    } as unknown as ApiRequest);
    expect(page.page).toEqual({ nextCursor: null, hasMore: false });
  });
});

describe('accounting student finance workspace health', () => {
  it('does not warn when v3 has more physical documents than canonical summaries', async () => {
    const page = await readAccountingStudentFinanceWorkspace(
      fakeDb(rows, {
        physicalStudentDocumentCount: rows.length + 4,
        studentCount: rows.length + 4,
      }),
      ctx,
      { query: {} } as unknown as ApiRequest
    );

    expect(page.dataIncomplete).toBe(false);
  });

  it.each([
    ['a repair backlog', { repairBacklog: 1 }],
    ['a missing canonical summary', { summaryCount: rows.length - 1 }],
    ['an explicitly incomplete projection', { complete: false }],
  ])('keeps the warning for %s', async (_label, healthOverride) => {
    const page = await readAccountingStudentFinanceWorkspace(fakeDb(rows, healthOverride), ctx, {
      query: {},
    } as unknown as ApiRequest);

    expect(page.dataIncomplete).toBe(true);
  });
});
