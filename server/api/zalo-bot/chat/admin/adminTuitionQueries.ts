import type { DocumentStore } from '@/server/db/documentStore.js';
import { VN_TIME_ZONE } from '../../../../../shared/dateTimeFormat.js';
import { formatInTimeZone } from 'date-fns-tz';
import {
  calculateLedgerBalance,
  deriveLedgerDisplayStatus,
  type LedgerLike,
} from '../../../../../shared/studentFinanceReport.js';
import type {
  AdminDataQuality,
  AdminDataQualityIssue,
  AdminStudentTuitionResult,
  AdminTuitionStatus,
} from './adminChatTypes.js';
import type { ResolvedCanonicalStudent } from './adminEntityResolver.js';

export const STUDENT_PROFILE_ALIASES_COLLECTION = 'student_profile_aliases';
export const COURSE_FEE_LEDGERS_COLLECTION = 'course_fee_ledgers';

/**
 * Retrieves the identity equivalence set of student profile IDs for a canonical student,
 * including any merged legacy aliases.
 */
export async function getStudentIdentityEquivalenceSet(
  db: DocumentStore,
  canonicalStudentId: string
): Promise<string[]> {
  const ids = new Set<string>([canonicalStudentId]);
  try {
    const aliasSnaps = await db
      .collection(STUDENT_PROFILE_ALIASES_COLLECTION)
      .where('canonicalProfileId', '==', canonicalStudentId)
      .limit(20)
      .get();

    for (const doc of aliasSnaps.docs) {
      ids.add(doc.id);
    }
  } catch {
    // If aliases collection query fails, proceed with canonical ID
  }
  return Array.from(ids);
}

/**
 * Queries tuition and payment status for a single resolved canonical student.
 */
export async function queryAdminStudentTuition(
  db: DocumentStore,
  student: ResolvedCanonicalStudent,
  now = new Date()
): Promise<AdminStudentTuitionResult> {
  const computedAt = now.toISOString();
  const todayStr = formatInTimeZone(now, VN_TIME_ZONE, 'yyyy-MM-dd');

  const studentIds = await getStudentIdentityEquivalenceSet(db, student.id);

  // Query ledgers across all equivalent student IDs (survivor + legacy aliases)
  const ledgerSnaps = await db
    .collection(COURSE_FEE_LEDGERS_COLLECTION)
    .where('studentId', 'in', studentIds)
    .limit(50)
    .get();

  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';

  if (ledgerSnaps.empty) {
    return {
      kind: 'student_tuition',
      student: {
        id: student.id,
        fullName: student.fullName,
        studentCode: student.studentCode,
        className: student.currentClassName,
      },
      courseLabel: null,
      paymentStatus: 'missing_ledger',
      grossBilled: null,
      discountTotal: null,
      netBilled: null,
      paidTotal: null,
      outstandingTotal: null,
      dueDate: null,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'canonical_student_ledgers_v1',
    };
  }

  // Pick the most relevant ledger (matching currentClassId or most recent by termStart / createdAt)
  const ledgers: Array<Record<string, unknown> & { id: string }> = ledgerSnaps.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  // Sort candidate ledgers: current class match first, then termStart DESC, then createdAt DESC
  ledgers.sort((a, b) => {
    const aClassMatch = student.currentClassId && a.classId === student.currentClassId ? 1 : 0;
    const bClassMatch = student.currentClassId && b.classId === student.currentClassId ? 1 : 0;
    if (aClassMatch !== bClassMatch) return bClassMatch - aClassMatch;

    const aStart = String(a.termStart || a.month || '');
    const bStart = String(b.termStart || b.month || '');
    if (aStart !== bStart) return bStart.localeCompare(aStart);

    const aCreated = String(a.createdAt || '');
    const bCreated = String(b.createdAt || '');
    return bCreated.localeCompare(aCreated);
  });

  const selectedLedger = ledgers[0];
  const ledgerLike: LedgerLike = {
    id: selectedLedger.id,
    amount: selectedLedger.amount,
    discountTotal: selectedLedger.discountTotal,
    paidTotal: selectedLedger.paidTotal,
    dueDate: typeof selectedLedger.dueDate === 'string' ? selectedLedger.dueDate : null,
    status: typeof selectedLedger.status === 'string' ? selectedLedger.status : undefined,
    classId: typeof selectedLedger.classId === 'string' ? selectedLedger.classId : undefined,
    termLabel: typeof selectedLedger.termLabel === 'string' ? selectedLedger.termLabel : undefined,
  };

  const balance = calculateLedgerBalance(ledgerLike);
  const displayInfo = deriveLedgerDisplayStatus(ledgerLike, todayStr);

  let paymentStatus: AdminTuitionStatus;
  switch (displayInfo.displayStatus) {
    case 'waived':
      paymentStatus = 'waived';
      break;
    case 'paid':
      paymentStatus = 'paid';
      break;
    case 'partial':
      paymentStatus = 'partial';
      break;
    case 'overdue':
      paymentStatus = 'overdue';
      break;
    case 'unpaid':
    case 'due_date_missing':
    default:
      paymentStatus = 'unpaid';
      break;
  }

  const courseLabel =
    typeof selectedLedger.termLabel === 'string' && selectedLedger.termLabel.trim()
      ? selectedLedger.termLabel.trim()
      : typeof selectedLedger.month === 'string'
        ? `Tháng ${selectedLedger.month}`
        : null;

  return {
    kind: 'student_tuition',
    student: {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      className: student.currentClassName,
    },
    courseLabel,
    paymentStatus,
    grossBilled: balance.grossAmount,
    discountTotal: balance.discount,
    netBilled: balance.netAmount,
    paidTotal: balance.paid,
    outstandingTotal: balance.outstanding,
    dueDate: ledgerLike.dueDate ?? null,
    quality: {
      status: qualityStatus,
      issues,
    },
    computedAt,
    source: 'canonical_student_ledgers_v1',
  };
}
