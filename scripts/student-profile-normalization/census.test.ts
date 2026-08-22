import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { collectFinanceAnomalyBaseline, collectStudentProfileCensus } from './census.js';

type FakeDoc = { id: string; value: Record<string, unknown> };

function fakeDocumentStore(collections: Record<string, FakeDoc[]>): DocumentStore {
  return {
    collection(name: string) {
      return {
        async get() {
          return {
            docs: (collections[name] || []).map((doc) => ({
              id: doc.id,
              data: () => structuredClone(doc.value),
            })),
            size: (collections[name] || []).length,
          };
        },
      };
    },
  } as unknown as DocumentStore;
}

const searchFields = {
  admissionSearchName: 'quach hoang minh',
  admissionSearchDob: '2014-05-02',
  admissionSearchContact: '0900000000',
};

describe('student profile census', () => {
  it('separates canonical profiles from tombstones and legacy soft merges', async () => {
    const db = fakeDocumentStore({
      students: [
        { id: 'canonical-1', value: { ...searchFields } },
        { id: 'canonical-2', value: { ...searchFields } },
        {
          id: 'legacy-1',
          value: { ...searchFields, mergedIntoStudentId: 'canonical-1', studentLifecycle: 'archived' },
        },
        {
          id: 'tombstone-1',
          value: { ...searchFields, studentProfileState: 'merged_tombstone' },
        },
      ],
      student_profile_aliases: [],
    });

    const census = await collectStudentProfileCensus(db);

    expect(census.physicalProfiles).toBe(4);
    expect(census.canonicalProfiles).toBe(2);
    expect(census.tombstones).toBe(1);
    expect(census.legacySoftMerges).toHaveLength(1);
    expect(census.legacySoftMerges[0]).toMatchObject({
      legacyProfileId: 'legacy-1',
      pointerTarget: 'canonical-1',
      pointerState: 'resolves',
      hasAlias: false,
    });
  });

  it('classifies every broken legacy pointer instead of dropping it', async () => {
    const db = fakeDocumentStore({
      students: [
        { id: 'canonical-1', value: { ...searchFields } },
        { id: 'ok', value: { ...searchFields, mergedIntoStudentId: 'canonical-1' } },
        { id: 'gone', value: { ...searchFields, mergedIntoStudentId: 'does-not-exist' } },
        { id: 'self', value: { ...searchFields, mergedIntoStudentId: 'self' } },
        { id: 'chained', value: { ...searchFields, mergedIntoStudentId: 'ok' } },
      ],
      student_profile_aliases: [{ id: 'ok', value: { canonicalProfileId: 'canonical-1' } }],
    });

    const census = await collectStudentProfileCensus(db);
    const byId = new Map(census.legacySoftMerges.map((row) => [row.legacyProfileId, row]));

    expect(byId.get('ok')).toMatchObject({ pointerState: 'resolves', hasAlias: true });
    expect(byId.get('gone')?.pointerState).toBe('missing_target');
    expect(byId.get('self')?.pointerState).toBe('self_pointer');
    expect(byId.get('chained')?.pointerState).toBe('target_also_retired');
    expect(census.aliasDocuments).toBe(1);
  });

  it('counts profiles missing any denormalized admission-search field', async () => {
    const db = fakeDocumentStore({
      students: [
        { id: 'complete', value: { ...searchFields } },
        { id: 'no-name', value: { admissionSearchDob: 'x', admissionSearchContact: 'y' } },
        { id: 'blank-contact', value: { ...searchFields, admissionSearchContact: '   ' } },
        { id: 'cloned', value: { name: 'CLONE', classId: 'class-1' } },
      ],
      student_profile_aliases: [],
    });

    const census = await collectStudentProfileCensus(db);

    expect(census.missingAdmissionSearchFields.total).toBe(3);
    expect(census.missingAdmissionSearchFields.profileIds).toEqual([
      'blank-contact',
      'cloned',
      'no-name',
    ]);
  });
});

describe('finance anomaly baseline', () => {
  // The ledger money field is `amount`, as written by
  // server/api/lib/accounting/courseLedgerPlanner.ts. An earlier draft assumed
  // `totalAmount` and the guard fired on every production ledger.
  it('records ledgers with no enrollment row and totals them as integers', async () => {
    const db = fakeDocumentStore({
      course_fee_ledgers: [
        { id: 'l-1', value: { studentId: 's-1', classId: 'c-1', amount: 1_200_000 } },
        { id: 'l-2', value: { studentId: 's-2', classId: 'c-2', amount: 800_000 } },
        { id: 'l-3', value: { studentId: 's-3', classId: 'c-3', amount: 500_000 } },
      ],
      student_course_enrollments: [
        { id: 'e-1', value: { studentId: 's-1', classId: 'c-1' } },
        { id: 'e-2', value: { studentId: 's-2', classId: 'c-other' } },
      ],
    });

    const baseline = await collectFinanceAnomalyBaseline(db);

    expect(baseline.orphanLedgers.map((row) => row.ledgerId)).toEqual(['l-2', 'l-3']);
    expect(baseline.totalOrphanAmount).toBe(1_300_000);
    expect(baseline.ledgersScanned).toBe(3);
  });

  it('rejects a non-integer ledger amount rather than silently coercing it', async () => {
    const db = fakeDocumentStore({
      course_fee_ledgers: [
        { id: 'l-bad', value: { studentId: 's-1', classId: 'c-1', amount: 1200.5 } },
      ],
      student_course_enrollments: [],
    });

    await expect(collectFinanceAnomalyBaseline(db)).rejects.toThrow(
      'STUDENT_CENSUS_LEDGER_AMOUNT_NOT_SAFE_INTEGER:l-bad'
    );
  });

  it('names the field it could not read so a wrong assumption is diagnosable', async () => {
    const db = fakeDocumentStore({
      course_fee_ledgers: [{ id: 'l-no-amount', value: { studentId: 's-1', classId: 'c-1' } }],
      student_course_enrollments: [],
    });

    await expect(collectFinanceAnomalyBaseline(db)).rejects.toThrow(
      'STUDENT_CENSUS_LEDGER_AMOUNT_MISSING:l-no-amount'
    );
  });
});
