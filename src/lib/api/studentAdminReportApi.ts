import { readChannel } from './readApi';
import type { AttendanceMode, ClassTerm } from '../../../shared/studentEnrollmentTimeline';
import type {
  StudentCourseFinanceSummary,
  StudentCourseEnrollmentView,
} from '../../../shared/accountingStudentFinance';

export type StudentTimelineSegment = {
  key: string;
  classId: string;
  className: string;
  classMissing: boolean;
  grade: number | null;
  term: ClassTerm;
  attendanceMode: AttendanceMode;
  enrollment: StudentCourseEnrollmentView | null;
};

export type StudentAttendanceReportRow = {
  date: string;
  classId: string;
  termKey: string;
  status: 'present' | 'late' | 'absent' | 'unmarked' | 'not_enrolled' | 'on_leave';
  absentWithPermission: boolean;
  minutesLate: number;
  source: 'scheduled' | 'makeup';
};

/** Display-only money estimate for one course. Never posted to a ledger. */
export type TermSessionValue = {
  courseTotalSessions: number;
  /** null when it cannot be computed — render '—', never 0. */
  pricePerSession: number | null;
  /** Excused absences + on-leave sessions. Already paid for. */
  refundable: { sessions: number; amount: number };
  /** Sessions before joining. Never paid for — an intake reduction, not a refund. */
  notEnrolled: { sessions: number; amount: number };
};

export type StudentLedgerReportRow = {
  id: string;
  periodKey: string;
  classId: string | null;
  /** Resolved server-side so archived classes still have a label. */
  className?: string;
  termKey: string | null;
  termStart: string | null;
  termEnd: string | null;
  termLabel: string | null;
  dueDate: string | null;
  grossAmount: number;
  discount: number;
  netAmount: number;
  paid: number;
  outstanding: number;
  displayStatus: 'waived' | 'paid' | 'overdue' | 'partial' | 'unpaid' | 'due_date_missing';
  isOverdue: boolean;
  hasDueDate: boolean;
  tuitionReminderCount?: number;
  tuitionReminderLastSentAt?: string | null;
};

export type StudentReceiptReportRow = {
  id: string;
  ledgerId: string;
  receiptNumber: string | null;
  date: string | null;
  amount: number;
  method: string | null;
  status: string | null;
  source: string | null;
};

export type ReportTruncation = {
  attendance: boolean;
  ledgers: boolean;
  classSessions: boolean;
};

export type StudentAdminReportResponse = {
  student: Record<string, unknown>;
  /**
   * The profile the server actually opened. A link written before a merge
   * names the retired id, and leaving that in the address bar turns it into a
   * bookmark and a shared link that outlive the merge.
   */
  canonicalProfileId?: string;
  requestedProfileId?: string;
  redirected?: boolean;
  timeline: StudentTimelineSegment[];
  attendanceRows: StudentAttendanceReportRow[];
  sessionValueByTerm: Record<string, TermSessionValue>;
  ledgers: StudentLedgerReportRow[];
  receipts: StudentReceiptReportRow[];
  courseSummaries?: StudentCourseFinanceSummary[];
  truncation: ReportTruncation;
  generatedAt: string;
};

/**
 * Checks the one thing the page cannot recover from on its own.
 *
 * A report opened through a link written before a merge is answered for the
 * surviving profile, and `redirected` is how the page knows to correct the
 * address bar. Arriving without the id it redirected *to* leaves the stale one
 * in the URL, where it becomes a bookmark and a shared link that outlive the
 * merge — so it is refused rather than rendered.
 *
 * Everything else passes through untouched: the server does not send canonical
 * fields in `legacy_compare`, and a decoder that demanded them would break the
 * surface it exists to protect.
 */
export function decodeStudentAdminReportResponse(
  response: StudentAdminReportResponse
): StudentAdminReportResponse {
  if (response.redirected === true && !String(response.canonicalProfileId || '').trim()) {
    throw new Error(
      'STUDENT_ADMIN_REPORT_REDIRECT_WITHOUT_CANONICAL_ID: the response says it redirected ' +
        'but not to which profile'
    );
  }
  return response;
}

export async function fetchStudentAdminReport(params: {
  studentId: string;
}): Promise<StudentAdminReportResponse> {
  return decodeStudentAdminReportResponse(
    await readChannel<StudentAdminReportResponse>('student-admin-report', {
      studentId: params.studentId,
    })
  );
}
