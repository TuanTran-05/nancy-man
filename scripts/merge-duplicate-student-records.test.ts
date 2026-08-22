import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertLegacyMergeWriteModeDisabled,
  buildMergePlan,
  chooseKeepRecord,
  keyedTargetDocId,
  mergeDuplicateStudentRecords,
  planMergeGroup,
  type ReferenceBundle,
  type StudentRecord,
} from './merge-duplicate-student-records.js';

type Store = Map<string, Record<string, unknown>>;

function makeDb(seed: Record<string, Record<string, unknown>>): any {
  const docs: Store = new Map(Object.entries(seed).map(([key, value]) => [key, { ...value }]));
  const docsIn = (collection: string) =>
    [...docs.entries()]
      .filter(([key]) => key.startsWith(`${collection}/`))
      .map(([key, data]) => ({ id: key.slice(collection.length + 1), data: () => data }));

  const docRef = (collection: string, id: string) => ({
    id,
    get: async () => ({
      exists: docs.has(`${collection}/${id}`),
      id,
      data: () => docs.get(`${collection}/${id}`),
    }),
    set: async (data: Record<string, unknown>) => {
      docs.set(`${collection}/${id}`, { ...data });
    },
    update: async (patch: Record<string, unknown>) => {
      const key = `${collection}/${id}`;
      if (!docs.has(key)) throw new Error(`No document to update: ${key}`);
      docs.set(key, { ...docs.get(key), ...patch });
    },
    delete: async () => {
      docs.delete(`${collection}/${id}`);
    },
  });

  return {
    docs,
    collection: (collection: string) => ({
      doc: (id: string) => docRef(collection, id),
      get: async () => ({ docs: docsIn(collection) }),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: docsIn(collection).filter((doc) => doc.data()?.[field] === value),
        }),
      }),
    }),
  };
}

const classStatusById = new Map([
  ['active-class', 'active'],
  ['closed-class', 'archived'],
]);

function bundle(overrides: Partial<ReferenceBundle> = {}): ReferenceBundle {
  return { field: {}, keyed: {}, derived: {}, users: [], authCredential: null, ...overrides };
}

describe('chooseKeepRecord', () => {
  it('keeps the record sitting in a class that is still running', () => {
    const records: StudentRecord[] = [
      { id: 'stale', data: { classId: 'closed-class', enrollmentStatus: 'promoted' } },
      { id: 'current', data: { classId: 'active-class', enrollmentStatus: 'active' } },
    ];

    const result = chooseKeepRecord(records, classStatusById);

    expect(result.keepId).toBe('current');
    expect(result.reasons).toContain('đang ở lớp còn hoạt động');
  });

  it('falls back to the freshest record and stays deterministic', () => {
    const records: StudentRecord[] = [
      { id: 'b', data: { classId: 'closed-class', updatedAt: '2026-01-01T00:00:00.000Z' } },
      { id: 'a', data: { classId: 'closed-class', updatedAt: '2026-06-01T00:00:00.000Z' } },
    ];

    expect(chooseKeepRecord(records, classStatusById).keepId).toBe('a');
  });

  it('does not keep an already archived record over a live one', () => {
    const records: StudentRecord[] = [
      { id: 'archived', data: { classId: 'closed-class', isRevoked: true } },
      { id: 'live', data: { classId: 'closed-class' } },
    ];

    expect(chooseKeepRecord(records, classStatusById).keepId).toBe('live');
  });
});

describe('keyedTargetDocId', () => {
  it('rebuilds every composite id around the surviving student', () => {
    const attendance = keyedTargetDocId(
      'attendance',
      { id: 'c1_stale_2026-06-20', data: { classId: 'c1', date: '2026-06-20' } },
      'keep'
    );
    const ledger = keyedTargetDocId(
      'course_fee_ledgers',
      {
        id: 'stale_c1_2026-06-13_2026-08-02',
        data: { classId: 'c1', termStart: '2026-06-13', termEnd: '2026-08-02' },
      },
      'keep'
    );
    const closing = keyedTargetDocId(
      'course_closing_records',
      { id: 'term_1__stale', data: { courseId: 'term_1' } },
      'keep'
    );

    expect(attendance).toBe('c1_keep_2026-06-20');
    expect(ledger).toBe('keep_c1_2026-06-13_2026-08-02');
    expect(closing).toBe('term_1__keep');
  });

  it('returns null when the row lacks the fields the id is built from', () => {
    expect(keyedTargetDocId('attendance', { id: 'x', data: {} }, 'keep')).toBeNull();
  });
});

describe('planMergeGroup', () => {
  const records: StudentRecord[] = [
    { id: 'stale', data: { name: 'AN', classId: 'closed-class', enrollmentStatus: 'promoted' } },
    { id: 'current', data: { name: 'An', classId: 'active-class', enrollmentStatus: 'active' } },
  ];

  it('moves references and plans the wallet transfer for a clean pair', () => {
    const plan = planMergeGroup({
      code: 'HS1',
      records: [
        { ...records[0], data: { ...records[0].data, walletBalance: 250_000 } },
        records[1],
      ],
      classStatusById,
      referencesByStudentId: new Map([
        [
          'stale',
          bundle({
            field: { evaluations: [{ id: 'e1', data: { studentId: 'stale' } }] },
            keyed: {
              course_fee_ledgers: [
                {
                  id: 'stale_c1_2026-06-13_2026-08-02',
                  data: { classId: 'c1', termStart: '2026-06-13', termEnd: '2026-08-02' },
                },
              ],
            },
          }),
        ],
        ['current', bundle()],
      ]),
      existingKeyedIds: new Map(),
    });

    expect(plan.keepId).toBe('current');
    expect(plan.mergeable).toBe(true);
    expect(plan.walletTransfer).toEqual({
      fromStudentId: 'stale',
      walletBalance: 250_000,
      walletOpeningBalance: 0,
      walletHistoryStartedAt: null,
    });
    expect(plan.moves).toContainEqual({
      collection: 'evaluations',
      fromDocId: 'e1',
      toDocId: 'e1',
      kind: 'field',
    });
    expect(plan.moves).toContainEqual({
      collection: 'course_fee_ledgers',
      fromDocId: 'stale_c1_2026-06-13_2026-08-02',
      toDocId: 'current_c1_2026-06-13_2026-08-02',
      kind: 'recreate',
    });
  });

  it('refuses to merge when both records hold money', () => {
    const plan = planMergeGroup({
      code: 'HS1',
      records: [
        { ...records[0], data: { ...records[0].data, walletBalance: 100 } },
        { ...records[1], data: { ...records[1].data, walletBalance: 200 } },
      ],
      classStatusById,
      referencesByStudentId: new Map([
        ['stale', bundle()],
        ['current', bundle()],
      ]),
      existingKeyedIds: new Map(),
    });

    expect(plan.mergeable).toBe(false);
    expect(plan.blockers).toContain('cả hai bản ghi đều có số dư ví');
  });

  it('refuses to merge when a ledger id would collide on the surviving record', () => {
    const plan = planMergeGroup({
      code: 'HS1',
      records,
      classStatusById,
      referencesByStudentId: new Map([
        [
          'stale',
          bundle({
            keyed: {
              course_fee_ledgers: [
                {
                  id: 'stale_c1_2026-06-13_2026-08-02',
                  data: { classId: 'c1', termStart: '2026-06-13', termEnd: '2026-08-02' },
                },
              ],
            },
          }),
        ],
        [
          'current',
          bundle({
            keyed: {
              course_fee_ledgers: [
                {
                  id: 'current_c1_2026-06-13_2026-08-02',
                  data: { classId: 'c1', termStart: '2026-06-13', termEnd: '2026-08-02' },
                },
              ],
            },
          }),
        ],
      ]),
      existingKeyedIds: new Map([
        ['course_fee_ledgers', new Set(['current_c1_2026-06-13_2026-08-02'])],
      ]),
    });

    expect(plan.mergeable).toBe(false);
    expect(plan.blockers).toContain('course_fee_ledgers đã có bản ghi trùng ở bản giữ lại');
  });

  it('refuses to merge records whose names disagree', () => {
    const plan = planMergeGroup({
      code: 'HS1',
      records: [records[0], { ...records[1], data: { ...records[1].data, name: 'Người khác' } }],
      classStatusById,
      referencesByStudentId: new Map([
        ['stale', bundle()],
        ['current', bundle()],
      ]),
      existingKeyedIds: new Map(),
    });

    expect(plan.mergeable).toBe(false);
    expect(plan.blockers).toContain('tên khác nhau giữa các bản ghi');
  });

  it('refuses to merge when both records own the same kind of login account', () => {
    const plan = planMergeGroup({
      code: 'HS1',
      records,
      classStatusById,
      referencesByStudentId: new Map([
        ['stale', bundle({ users: [{ id: 'parent:stale', data: { studentId: 'stale' } }] })],
        ['current', bundle({ users: [{ id: 'parent:current', data: { studentId: 'current' } }] })],
      ]),
      existingKeyedIds: new Map(),
    });

    expect(plan.mergeable).toBe(false);
    expect(plan.blockers).toContain('cả hai bản ghi đều có tài khoản đăng nhập');
  });

  it('renames a login account that is keyed by the merged-away student id', () => {
    const plan = planMergeGroup({
      code: 'HS1',
      records,
      classStatusById,
      referencesByStudentId: new Map([
        ['stale', bundle({ users: [{ id: 'parent:stale', data: { studentId: 'stale' } }] })],
        ['current', bundle({ users: [{ id: 'student:current', data: { studentId: 'current' } }] })],
      ]),
      existingKeyedIds: new Map(),
    });

    expect(plan.mergeable).toBe(true);
    expect(plan.moves).toContainEqual({
      collection: 'users',
      fromDocId: 'parent:stale',
      toDocId: 'parent:current',
      kind: 'recreate',
    });
  });
});

describe('buildMergePlan', () => {
  it('ignores codes that appear only once', () => {
    const plan = buildMergePlan({
      students: [
        { id: 'a', data: { studentId: 'HS1', name: 'An', classId: 'active-class' } },
        { id: 'b', data: { studentId: 'HS2', name: 'Bình', classId: 'active-class' } },
      ],
      classStatusById,
      referencesByStudentId: new Map(),
      existingKeyedIds: new Map(),
    });

    expect(plan.groups).toEqual([]);
    expect(plan.duplicateCodes).toBe(0);
  });
});

describe('mergeDuplicateStudentRecords', () => {
  let db: any;

  beforeEach(() => {
    db = makeDb({
      'students/stale': {
        studentId: 'HS1',
        name: 'QUÁCH HOÀNG MINH',
        classId: 'closed-class',
        enrollmentStatus: 'promoted',
        walletBalance: 250_000,
        walletOpeningBalance: 250_000,
        walletHistoryStartedAt: '2026-07-01T00:00:00.000Z',
      },
      'students/current': {
        studentId: 'HS1',
        name: 'Quách Hoàng Minh',
        classId: 'active-class',
        enrollmentStatus: 'active',
        walletBalance: 0,
      },
      'classes/active-class': { name: 'G7', status: 'active' },
      'classes/closed-class': { name: 'G6', status: 'archived' },
      'evaluations/e1': { studentId: 'stale', score: 8 },
      // Half-fixed by an earlier data patch: the id still carries the stale
      // student while the field already points at the surviving record.
      'users/parent:stale': { role: 'parent', studentId: 'current' },
      'attendance/closed-class_stale_2026-06-20': {
        studentId: 'stale',
        classId: 'closed-class',
        date: '2026-06-20',
      },
      'accounting_student_summaries/sum-1': { studentId: 'stale' },
    });
  });

  it('reports the plan without writing anything on a dry run', async () => {
    const summary = await mergeDuplicateStudentRecords({ db });

    expect(summary).toMatchObject({
      dryRun: true,
      duplicateCodes: 1,
      mergeableGroups: 1,
      blockedGroups: 0,
      mergedGroups: 0,
    });
    expect(db.docs.get('students/stale').mergedIntoStudentId).toBeUndefined();
    expect(db.docs.get('evaluations/e1').studentId).toBe('stale');
  });

  // This script's write mode is permanently disabled. It moved only fourteen
  // collections out of the sixty-six the server uses, wrote no aliases, and
  // left the retired document marked with `mergedIntoStudentId` — the state
  // the normalization engine now has to repair. Its dry run stays available
  // for comparison; its writer does not.
  it('refuses programmatic apply before reading anything', async () => {
    await expect(mergeDuplicateStudentRecords({ db, apply: true })).rejects.toThrow(
      'LEGACY_STUDENT_MERGE_DISABLED'
    );

    expect(db.docs.get('evaluations/e1').studentId).toBe('stale');
    expect(db.docs.get('students/stale').mergedIntoStudentId).toBeUndefined();
  });

  it('refuses apply without touching the database at all', async () => {
    const exploding = new Proxy(
      {},
      {
        get() {
          throw new Error('LEGACY_MERGE_TOUCHED_FIRESTORE');
        },
      }
    ) as never;

    await expect(mergeDuplicateStudentRecords({ db: exploding, apply: true })).rejects.toThrow(
      'LEGACY_STUDENT_MERGE_DISABLED'
    );
  });

  it('limits the scan to the requested codes', async () => {
    const summary = await mergeDuplicateStudentRecords({ db, codes: ['HS999'] });

    expect(summary).toMatchObject({ duplicateCodes: 0, mergeableGroups: 0 });
  });

  it('marks its dry-run output as deprecated so it is not mistaken for the new engine', async () => {
    const summary = await mergeDuplicateStudentRecords({ db });

    expect(summary).toMatchObject({ dryRun: true, deprecated: true });
  });
});

describe('legacy merge CLI write guard', () => {
  // The guard must run during argument parsing. main() initializes Firebase
  // before it inspects any flag, so a check placed later would already have
  // opened a production connection with write credentials.
  it.each(['--apply', '--write', '--commit', '--force', '--execute'])(
    'rejects %s',
    (flag) => {
      expect(() => assertLegacyMergeWriteModeDisabled(['--code', 'HS1', flag])).toThrow(
        'LEGACY_STUDENT_MERGE_DISABLED'
      );
    }
  );

  it('allows read-only invocations through', () => {
    expect(() =>
      assertLegacyMergeWriteModeDisabled(['--code', 'HS1', '--write-manifest', 'out.json'])
    ).not.toThrow();
  });
});
