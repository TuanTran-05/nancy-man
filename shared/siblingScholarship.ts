import { deriveStudentLifecycle } from './studentLifecycle.js';

/** Sibling scholarship rate, in percentage points of the ledger's full amount. */
export const SIBLING_DISCOUNT_PERCENT = 10;

export type SiblingStudentRecord = {
  id?: string;
  siblingGroupId?: unknown;
  studentLifecycle?: unknown;
  enrollmentStatus?: unknown;
  isRevoked?: unknown;
  deletedAt?: unknown;
};

export type SiblingIneligibilityReason = 'no_group' | 'student_inactive' | 'no_active_sibling';

export type SiblingEligibility = {
  eligible: boolean;
  reason: SiblingIneligibilityReason | null;
  activeCount: number;
};

function groupIdOf(student: SiblingStudentRecord): string {
  return String(student.siblingGroupId || '').trim();
}

/**
 * A student counts towards the sibling scholarship only while actually studying.
 *
 * Lifecycle goes through `deriveStudentLifecycle` so revoked and soft-deleted
 * records resolve to `archived` rather than reading as enrolled. A missing
 * `enrollmentStatus` means `active`, matching `shared/studentRecords.ts`.
 */
export function isActiveForSibling(student: SiblingStudentRecord): boolean {
  if (deriveStudentLifecycle(student) !== 'enrolled') return false;
  return String(student.enrollmentStatus || 'active') === 'active';
}

export function getActiveSiblingGroupMembers<T extends SiblingStudentRecord>(
  student: T,
  pool: readonly T[]
): T[] {
  const groupId = groupIdOf(student);
  if (!groupId) return [];
  return pool.filter((member) => groupIdOf(member) === groupId && isActiveForSibling(member));
}

/**
 * The scholarship is in effect only while the student is studying AND at least
 * one other member of their group is too, so a group that drops to a single
 * active student loses it entirely.
 */
export function describeSiblingEligibility(
  student: SiblingStudentRecord,
  pool: readonly SiblingStudentRecord[]
): SiblingEligibility {
  if (!groupIdOf(student)) return { eligible: false, reason: 'no_group', activeCount: 0 };

  const activeCount = getActiveSiblingGroupMembers(student, pool).length;
  if (!isActiveForSibling(student)) {
    return { eligible: false, reason: 'student_inactive', activeCount };
  }
  if (activeCount < 2) return { eligible: false, reason: 'no_active_sibling', activeCount };
  return { eligible: true, reason: null, activeCount };
}

export function isSiblingScholarshipEligible(
  student: SiblingStudentRecord,
  pool: readonly SiblingStudentRecord[]
): boolean {
  return describeSiblingEligibility(student, pool).eligible;
}

export type SiblingMatchKind = 'direct' | 'sibling';

export type SiblingSearchRow<T extends SiblingStudentRecord> = {
  student: T;
  matchKind: SiblingMatchKind;
  siblingOf?: string;
};

function idOf(student: SiblingStudentRecord): string {
  return String(student.id || '').trim();
}

/**
 * Expands directly-matching students with their siblings drawn from `pool`,
 * which is expected to already respect the caller's filters.
 *
 * A student who matches directly is always emitted as `'direct'`, never also as
 * someone else's sibling — otherwise searching a common family name duplicates rows.
 */
export function expandWithSiblings<T extends SiblingStudentRecord>(
  matched: readonly T[],
  pool: readonly T[]
): SiblingSearchRow<T>[] {
  const directIds = new Set(matched.map(idOf).filter(Boolean));
  const emittedSiblingIds = new Set<string>();
  const rows: SiblingSearchRow<T>[] = [];

  for (const student of matched) {
    rows.push({ student, matchKind: 'direct' });

    const groupId = groupIdOf(student);
    if (!groupId) continue;
    const studentId = idOf(student);

    for (const candidate of pool) {
      const candidateId = idOf(candidate);
      if (!candidateId) continue;
      if (candidateId === studentId) continue;
      if (groupIdOf(candidate) !== groupId) continue;
      if (directIds.has(candidateId)) continue;
      if (emittedSiblingIds.has(candidateId)) continue;

      emittedSiblingIds.add(candidateId);
      rows.push({ student: candidate, matchKind: 'sibling', siblingOf: studentId });
    }
  }

  return rows;
}

/** The lifetime sibling scholarship a single ledger is worth. */
export function siblingEntitlementFor(ledgerAmount: number): number {
  if (!Number.isFinite(ledgerAmount) || ledgerAmount <= 0) return 0;
  return Math.round((ledgerAmount * SIBLING_DISCOUNT_PERCENT) / 100);
}

/**
 * How much sibling scholarship this receipt may grant.
 *
 * The entitlement is per ledger, so a course collected in instalments receives
 * 10% in total rather than 10% per receipt. `siblingDiscountTotal` is what the
 * ledger has already been granted.
 */
export function computeSiblingGrant(args: {
  ledgerAmount: number;
  siblingDiscountTotal: number;
  eligible: boolean;
  waived: boolean;
  isFullWaiver: boolean;
}): number {
  if (!args.eligible || args.waived || args.isFullWaiver) return 0;
  const granted = Number.isFinite(args.siblingDiscountTotal)
    ? Math.max(0, args.siblingDiscountTotal)
    : 0;
  return Math.max(0, siblingEntitlementFor(args.ledgerAmount) - granted);
}
