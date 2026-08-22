import { describe, expect, it } from 'vitest';
import {
  ClassTuitionReconciliationRepository,
  ClassReconciliationTooLargeError,
  MAX_CLASS_RECONCILIATION_DOCS,
  MAX_CLASS_RECONCILIATION_RECEIPTS,
  MAX_CLASS_RECONCILIATION_CLASS_RECEIPTS,
} from './classTuitionReconciliationRepository.js';

type FakeDoc = { id: string; exists: boolean; data: () => Record<string, unknown> };

function createFakeDoc(id: string, data: Record<string, unknown>, exists = true): FakeDoc {
  return {
    id,
    exists,
    data: () => data,
  };
}

describe('ClassTuitionReconciliationRepository', () => {
  it('listClasses filters classes by valid status and does not mutate raw properties', async () => {
    const classDocs = [
      createFakeDoc('c1', { name: 'Active Class', status: 'active', startDate: '2026-01-01' }),
      createFakeDoc('c2', { name: 'Paused Class', status: 'paused' }),
      createFakeDoc('c3', { name: 'Archived Class', status: 'archived' }),
      createFakeDoc('c4', { name: 'Draft Class', status: 'draft' }), // excluded
      createFakeDoc('c5', { name: 'Deleted Class', status: 'deleted' }), // excluded
    ];

    const fakeDb: any = {
      collection: (name: string) => {
        expect(name).toBe('classes');
        return {
          get: async () => ({ docs: classDocs, size: classDocs.length }),
        };
      },
      getAll: async () => [],
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const classes = await repo.listClasses();
    expect(classes).toHaveLength(3);
    expect(classes.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(classes[0]).toEqual({
      id: 'c1',
      name: 'Active Class',
      status: 'active',
      teacherId: '',
      teacherName: '',
      currentCourseId: undefined,
      startDate: '2026-01-01',
      endDate: undefined,
      tuitionFee: undefined,
      terms: [],
    });
  });

  it('listClasses resolves teacher display names from users, preferring displayName over name over email', async () => {
    const classDocs = [
      createFakeDoc('c1', { name: 'Toan 9A', status: 'active', teacherId: 't1' }),
      createFakeDoc('c2', { name: 'Toan 9B', status: 'active', teacherId: 't2' }),
      createFakeDoc('c3', { name: 'Ly 12C', status: 'paused', teacherId: 't3' }),
      createFakeDoc('c4', { name: 'Van 8A', status: 'archived', teacherId: 't-missing' }),
      createFakeDoc('c5', { name: 'Tu hoc', status: 'active' }),
    ];

    const userDocs: Record<string, FakeDoc> = {
      t1: createFakeDoc('t1', { displayName: 'Nguyen Van A', name: 'ignored', email: 'a@x.vn' }),
      t2: createFakeDoc('t2', { name: 'Tran Thi B', email: 'b@x.vn' }),
      t3: createFakeDoc('t3', { email: 'c@x.vn' }),
      't-missing': createFakeDoc('t-missing', {}, false),
    };

    let requestedUserIds: string[] = [];
    const fakeDb: any = {
      collection: (name: string) => {
        if (name === 'users') {
          return { doc: (id: string) => ({ id, path: `users/${id}` }) };
        }
        expect(name).toBe('classes');
        return { get: async () => ({ docs: classDocs, size: classDocs.length }) };
      },
      getAll: async (...refs: any[]) => {
        requestedUserIds = refs.map((ref) => ref.id);
        return refs.map((ref) => userDocs[ref.id]).filter(Boolean);
      },
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const classes = await repo.listClasses();

    // A class with no teacherId must not produce a lookup for the empty string.
    expect(requestedUserIds).toEqual(['t1', 't2', 't3', 't-missing']);

    const byId = new Map(classes.map((c) => [c.id, c]));
    expect(byId.get('c1')?.teacherName).toBe('Nguyen Van A');
    expect(byId.get('c2')?.teacherName).toBe('Tran Thi B');
    expect(byId.get('c3')?.teacherName).toBe('c@x.vn');
    // Teacher doc is gone: keep the id so the UI can still show its fallback label.
    expect(byId.get('c4')?.teacherId).toBe('t-missing');
    expect(byId.get('c4')?.teacherName).toBe('');
    expect(byId.get('c5')?.teacherId).toBe('');
    expect(byId.get('c5')?.teacherName).toBe('');
  });

  it('listClasses looks teachers up in chunks of 100 and deduplicates shared teachers', async () => {
    const classDocs = Array.from({ length: 250 }, (_, i) =>
      createFakeDoc(`c${i}`, { name: `Class ${i}`, status: 'active', teacherId: `t${i % 150}` })
    );

    const chunkSizes: number[] = [];
    const fakeDb: any = {
      collection: (name: string) => {
        if (name === 'users') {
          return { doc: (id: string) => ({ id, path: `users/${id}` }) };
        }
        return { get: async () => ({ docs: classDocs, size: classDocs.length }) };
      },
      getAll: async (...refs: any[]) => {
        chunkSizes.push(refs.length);
        return refs.map((ref) => createFakeDoc(ref.id, { displayName: `GV ${ref.id}` }));
      },
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const classes = await repo.listClasses();

    expect(chunkSizes).toEqual([100, 50]);
    expect(classes[0].teacherName).toBe('GV t0');
    expect(classes[200].teacherName).toBe('GV t50');
  });

  it('getClass returns mapped class source or null when missing', async () => {
    const fakeDb: any = {
      collection: (name: string) => {
        if (name === 'users') {
          return { doc: (id: string) => ({ id, path: `users/${id}` }) };
        }
        return {
          doc: (id: string) => ({
            get: async () => {
              if (id === 'c1') {
                return createFakeDoc('c1', {
                  name: 'Class 1',
                  status: 'active',
                  tuitionFee: 2_000_000,
                  teacherId: 't1',
                });
              }
              return createFakeDoc(id, {}, false);
            },
          }),
        };
      },
      getAll: async (...refs: any[]) =>
        refs.map((ref) => createFakeDoc(ref.id, { displayName: 'Nguyen Van A' })),
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const c1 = await repo.getClass('c1');
    expect(c1).not.toBeNull();
    expect(c1?.name).toBe('Class 1');
    expect(c1?.tuitionFee).toBe(2_000_000);
    expect(c1?.teacherId).toBe('t1');
    expect(c1?.teacherName).toBe('Nguyen Van A');

    const cNone = await repo.getClass('none');
    expect(cNone).toBeNull();
  });

  it('getClass skips the users lookup entirely when the class has no teacherId', async () => {
    let getAllCalls = 0;
    const fakeDb: any = {
      collection: (name: string) => {
        if (name === 'users') {
          return { doc: (id: string) => ({ id, path: `users/${id}` }) };
        }
        return {
          doc: () => ({
            get: async () => createFakeDoc('c1', { name: 'Class 1', status: 'active' }),
          }),
        };
      },
      getAll: async (...refs: any[]) => {
        getAllCalls += 1;
        return refs.map((ref) => createFakeDoc(ref.id, {}));
      },
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const c1 = await repo.getClass('c1');

    expect(getAllCalls).toBe(0);
    expect(c1?.teacherId).toBe('');
    expect(c1?.teacherName).toBe('');
  });

  it('preserves raw invalid money fields for enrollments and ledgers without zero-coercion', async () => {
    const ledgerDocs = [
      createFakeDoc('l1', { classId: 'c1', termStart: '2026-01-01', amount: 'invalid', discountTotal: -500, paidTotal: NaN }),
    ];

    const fakeDb: any = {
      collection: (col: string) => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ docs: ledgerDocs, size: ledgerDocs.length }),
          }),
        }),
      }),
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const ledgers = await repo.listLedgersByClass('c1');
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].amount).toBe('invalid');
    expect(ledgers[0].discountTotal).toBe(-500);
    expect(Number.isNaN(ledgers[0].paidTotal)).toBe(true);
  });

  it('listStudentsByIds maps name -> fullName and studentId -> studentCode across 100-ref chunks', async () => {
    const studentDocs = [
      createFakeDoc('st1', { name: 'Nguyen Van A', studentId: 'HV001' }),
      createFakeDoc('st2', { name: 'Tran Thi B', studentId: 'HV002' }),
      createFakeDoc('st-missing', {}, false),
    ];

    let getAllCalledWith: any[] = [];
    const fakeDb: any = {
      collection: (name: string) => {
        expect(name).toBe('students');
        return {
          doc: (id: string) => ({ id, path: `students/${id}` }),
        };
      },
      getAll: async (...refs: any[]) => {
        getAllCalledWith = refs;
        return studentDocs;
      },
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const students = await repo.listStudentsByIds(['st1', 'st2', 'st-missing']);

    expect(getAllCalledWith).toHaveLength(3);
    expect(students).toEqual([
      { id: 'st1', fullName: 'Nguyen Van A', studentCode: 'HV001' },
      { id: 'st2', fullName: 'Tran Thi B', studentCode: 'HV002' },
    ]);
  });

  it('throws ClassReconciliationTooLargeError when enrollment or ledger query exceeds 5000 docs', async () => {
    const fakeDocs = Array.from({ length: MAX_CLASS_RECONCILIATION_DOCS + 1 }, (_, i) =>
      createFakeDoc(`doc_${i}`, { classId: 'c1' })
    );

    const fakeDb: any = {
      collection: (col: string) => ({
        where: () => ({
          where: () => ({
            limit: () => ({
              get: async () => ({ docs: fakeDocs, size: fakeDocs.length }),
            }),
          }),
          limit: () => ({
            get: async () => ({ docs: fakeDocs, size: fakeDocs.length }),
          }),
        }),
      }),
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);

    await expect(repo.listEnrollmentsByClass('c1')).rejects.toThrow(ClassReconciliationTooLargeError);
    await expect(repo.listLedgersByCourse('c1', '2026-01-01')).rejects.toThrow(ClassReconciliationTooLargeError);
  });

  it('listPostedReceiptsByStudent queries only posted receipts and enforces 500 limit', async () => {
    let whereFilters: Array<[string, string, any]> = [];
    let limitValue = 0;

    const fakeDb: any = {
      collection: (col: string) => {
        expect(col).toBe('receipts');
        const q: any = {
          where: (f: string, op: string, val: any) => {
            whereFilters.push([f, op, val]);
            return q;
          },
          limit: (n: number) => {
            limitValue = n;
            return {
              get: async () => ({ docs: [createFakeDoc('r1', { status: 'posted', amountReceived: 1000 })], size: 1 }),
            };
          },
        };
        return q;
      },
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const receipts = await repo.listPostedReceiptsByStudent('st1');

    expect(receipts).toHaveLength(1);
    expect(whereFilters).toEqual([
      ['studentId', '==', 'st1'],
      ['status', '==', 'posted'],
    ]);
    expect(limitValue).toBe(MAX_CLASS_RECONCILIATION_RECEIPTS + 1);
  });

  it('listPostedReceiptsByClass pages across 500 batches via startAfter and stops when empty', async () => {
    let pageCount = 0;
    const page1Docs = Array.from({ length: 500 }, (_, i) =>
      createFakeDoc(`r_p1_${i}`, { status: 'posted', createdAt: '2026-08-01' })
    );
    const page2Docs = [
      createFakeDoc('r_p2_1', { status: 'posted', createdAt: '2026-07-01' }),
    ];

    const fakeDb: any = {
      collection: (col: string) => {
        expect(col).toBe('receipts');
        const q: any = {
          where: () => q,
          orderBy: () => q,
          limit: () => q,
          startAfter: () => q,
          get: async () => {
            pageCount++;
            if (pageCount === 1) return { docs: page1Docs, empty: false, size: 500 };
            if (pageCount === 2) return { docs: page2Docs, empty: false, size: 1 };
            return { docs: [], empty: true, size: 0 };
          },
        };
        return q;
      },
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    const receipts = await repo.listPostedReceiptsByClass('class-1');

    expect(pageCount).toBe(2);
    expect(receipts).toHaveLength(501);
  });

  it('listPostedReceiptsByClass throws ClassReconciliationTooLargeError when total receipts exceed 5000', async () => {
    const pageDocs = Array.from({ length: 500 }, (_, i) =>
      createFakeDoc(`r_${i}`, { status: 'posted' })
    );

    const fakeDb: any = {
      collection: () => {
        const q: any = {
          where: () => q,
          orderBy: () => q,
          limit: () => q,
          startAfter: () => q,
          get: async () => ({ docs: pageDocs, empty: false, size: 500 }),
        };
        return q;
      },
    };

    const repo = new ClassTuitionReconciliationRepository(fakeDb);
    await expect(repo.listPostedReceiptsByClass('class-1')).rejects.toThrow(ClassReconciliationTooLargeError);
  });
});
