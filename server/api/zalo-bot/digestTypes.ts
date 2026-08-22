import { PrintRequestStatus } from '../../../shared/printRequests.js';
import { CourseClosingSnapshot } from '../../../shared/courseClosing.js';
import { ZaloBotStaffRole } from '../../../shared/zaloBot.js';

export type AttendanceDigestSource = {
  classId: string;
  className: string;
  date: string;
  scheduled: boolean;
  sessionStatus: 'unconfirmed' | 'taught' | 'cancelled' | 'makeup';
  primaryTeacherId: string;
  effectiveTeacherId: string;
  eligibleStudentIds: string[];
  markedStudentIds: string[];
};

export type CourseClosingDigestSource = {
  classId: string;
  className: string;
  primaryTeacherId: string;
  endDate: string;
  snapshot: CourseClosingSnapshot;
};

export type PrintDigestSource = {
  requestId: string;
  className: string;
  teacherName: string;
  neededDate: string;
  status: PrintRequestStatus;
  fileCount: number;
  totalCopies: number;
};

export type ActiveZaloBotRecipient = {
  staffId: string;
  role: ZaloBotStaffRole;
  displayName: string;
  chatIdHash: string;
};

export type ZaloBotDigestSourceCounts = {
  classes: number;
  sessions: number;
  attendanceRows: number;
  printRequests: number;
  activeLinks: number;
  eligibleRecipients: number;
  outstandingFailedMessages: number;
  potentialTruncation: string[];
};

export type DailyDigestRuleInput = {
  digestDate: string;
  tomorrowDate: string;
  activeRecipients: ActiveZaloBotRecipient[];
  attendance: AttendanceDigestSource[];
  courseClosing: CourseClosingDigestSource[];
  printRequests: PrintDigestSource[];
  sourceCounts: ZaloBotDigestSourceCounts;
};

export type AttendanceReminderItem = Pick<
  AttendanceDigestSource,
  'classId' | 'className' | 'date'
> & { missingStudentCount: number };
export type CourseClosingReminderItem = Pick<
  CourseClosingDigestSource,
  'classId' | 'className' | 'endDate'
> & { snapshotStatus: CourseClosingSnapshot['status'] };
export type PrintReminderItem = Omit<PrintDigestSource, 'status'>;

export type AdminDigestSummary = {
  linkedRecipients: number;
  eligibleRecipients: number;
  missingAttendanceClasses: number;
  courseClosingClasses: number;
  pendingPrintRequests: number;
  outstandingFailedMessages: number;
  potentialTruncation: string[];
};
