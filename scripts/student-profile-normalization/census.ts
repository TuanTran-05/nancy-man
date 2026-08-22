import type { DocumentStore } from '@/server/db/documentStore.js';

/**
 * Phase 0 census.
 *
 * Read-only counts that size the normalization work and freeze the baseline the
 * cutover later verifies against. Three questions it answers:
 *
 * 1. How many of the existing soft merges are actually normalizable, and how
 *    many have a broken pointer? The legacy script wrote `mergedIntoStudentId`
 *    and no alias, so nothing in the application currently understands them.
 * 2. How many profiles are invisible to an `admissionSearch*` equality query?
 *    The creation guard silently under-matches while that count is non-zero.
 * 3. Which finance anomalies already exist? Recording them here keeps a
 *    pre-existing orphan ledger from failing a gate inside the cutover window.
 */

export const ADMISSION_SEARCH_FIELDS = [
  'admissionSearchName',
  'admissionSearchDob',
  'admissionSearchContact',
] as const;

export type LegacySoftMergePointerState =
  | 'resolves'
  | 'missing_target'
  | 'self_pointer'
  | 'target_also_retired';

export type LegacySoftMergeRecord = {
  legacyProfileId: string;
  pointerTarget: string;
  pointerState: LegacySoftMergePointerState;
  hasAlias: boolean;
};

export type StudentProfileCensus = {
  physicalProfiles: number;
  canonicalProfiles: number;
  tombstones: number;
  aliasDocuments: number;
  legacySoftMerges: LegacySoftMergeRecord[];
  missingAdmissionSearchFields: { total: number; profileIds: string[] };
};

export type OrphanLedgerRecord = {
  ledgerId: string;
  studentId: string;
  classId: string;
  amount: number;
};

export type FinanceAnomalyBaseline = {
  ledgersScanned: number;
  orphanLedgers: OrphanLedgerRecord[];
  totalOrphanAmount: number;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function collectStudentProfileCensus(db: DocumentStore): Promise<StudentProfileCensus> {
  const [studentsSnapshot, aliasesSnapshot] = await Promise.all([
    db.collection('students').get(),
    db.collection('student_profile_aliases').get(),
  ]);

  const aliasIds = new Set(aliasesSnapshot.docs.map((doc) => doc.id));
  const retiredIds = new Set<string>();
  const liveIds = new Set<string>();
  const rows = studentsSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: (doc.data() || {}) as Record<string, unknown>,
  }));

  for (const row of rows) {
    const pointer = text(row.data.mergedIntoStudentId);
    const isTombstone = row.data.studentProfileState === 'merged_tombstone';
    if (pointer || isTombstone) retiredIds.add(row.id);
    else liveIds.add(row.id);
  }

  const legacySoftMerges: LegacySoftMergeRecord[] = [];
  const missingSearchFields: string[] = [];
  let tombstones = 0;

  for (const row of rows) {
    if (row.data.studentProfileState === 'merged_tombstone') tombstones += 1;

    if (ADMISSION_SEARCH_FIELDS.some((field) => text(row.data[field]) === '')) {
      missingSearchFields.push(row.id);
    }

    const pointer = text(row.data.mergedIntoStudentId);
    if (!pointer) continue;

    let pointerState: LegacySoftMergePointerState;
    if (pointer === row.id) pointerState = 'self_pointer';
    else if (liveIds.has(pointer)) pointerState = 'resolves';
    else if (retiredIds.has(pointer)) pointerState = 'target_also_retired';
    else pointerState = 'missing_target';

    legacySoftMerges.push({
      legacyProfileId: row.id,
      pointerTarget: pointer,
      pointerState,
      hasAlias: aliasIds.has(row.id),
    });
  }

  legacySoftMerges.sort((left, right) => left.legacyProfileId.localeCompare(right.legacyProfileId));
  missingSearchFields.sort((left, right) => left.localeCompare(right));

  return {
    physicalProfiles: rows.length,
    canonicalProfiles: liveIds.size,
    tombstones,
    aliasDocuments: aliasIds.size,
    legacySoftMerges,
    missingAdmissionSearchFields: {
      total: missingSearchFields.length,
      profileIds: missingSearchFields,
    },
  };
}

export async function collectFinanceAnomalyBaseline(
  db: DocumentStore
): Promise<FinanceAnomalyBaseline> {
  const [ledgersSnapshot, enrollmentsSnapshot] = await Promise.all([
    db.collection('course_fee_ledgers').get(),
    db.collection('student_course_enrollments').get(),
  ]);

  const enrolled = new Set(
    enrollmentsSnapshot.docs.map((doc) => {
      const data = (doc.data() || {}) as Record<string, unknown>;
      return `${text(data.studentId)}::${text(data.classId)}`;
    })
  );

  const orphanLedgers: OrphanLedgerRecord[] = [];
  let totalOrphanAmount = 0;

  for (const doc of ledgersSnapshot.docs) {
    const data = (doc.data() || {}) as Record<string, unknown>;
    // `amount` is the field course-fee ledgers are written with; see
    // server/api/lib/accounting/courseLedgerPlanner.ts.
    const amount = data.amount;
    if (amount === undefined || amount === null) {
      throw new Error(`STUDENT_CENSUS_LEDGER_AMOUNT_MISSING:${doc.id}`);
    }
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
      throw new Error(`STUDENT_CENSUS_LEDGER_AMOUNT_NOT_SAFE_INTEGER:${doc.id}`);
    }
    const studentId = text(data.studentId);
    const classId = text(data.classId);
    if (enrolled.has(`${studentId}::${classId}`)) continue;

    orphanLedgers.push({ ledgerId: doc.id, studentId, classId, amount });
    totalOrphanAmount += amount;
  }

  orphanLedgers.sort((left, right) => left.ledgerId.localeCompare(right.ledgerId));

  return { ledgersScanned: ledgersSnapshot.docs.length, orphanLedgers, totalOrphanAmount };
}
