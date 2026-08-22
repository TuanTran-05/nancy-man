import { differenceInCalendarDays, parseISO } from 'date-fns';
import {
  DailyDigestRuleInput,
  ZaloBotDigestSourceCounts,
  AttendanceReminderItem,
  CourseClosingReminderItem,
  PrintReminderItem,
  AdminDigestSummary,
  ActiveZaloBotRecipient,
} from './digestTypes.js';
import { ZaloBotStaffRole } from '../../../shared/zaloBot.js';

export type ZaloBotDigestRecipient = {
  staffId: string;
  role: ZaloBotStaffRole;
  attendance: AttendanceReminderItem[];
  courseClosing: CourseClosingReminderItem[];
  printRequests: PrintReminderItem[];
  adminSummary?: AdminDigestSummary;
};

export type ZaloBotDigestPlan = Map<string, ZaloBotDigestRecipient>;

export function buildZaloBotDigestPlan(input: DailyDigestRuleInput): ZaloBotDigestPlan {
  const plan: ZaloBotDigestPlan = new Map();
  const digestDateObj = parseISO(input.digestDate);

  // Initialize all active recipients in the plan
  for (const recipient of input.activeRecipients) {
    plan.set(recipient.staffId, {
      staffId: recipient.staffId,
      role: recipient.role,
      attendance: [],
      courseClosing: [],
      printRequests: [],
    });
  }

  // 1. Process Attendance
  const pendingAttendance = input.attendance.filter((att) => {
    if (att.sessionStatus === 'cancelled') return false;
    if (att.scheduled || att.sessionStatus === 'taught' || att.sessionStatus === 'makeup') {
      const markedSet = new Set(att.markedStudentIds);
      const missingCount = att.eligibleStudentIds.filter((id) => !markedSet.has(id)).length;
      return missingCount > 0;
    }
    return false;
  });

  const attendanceSetByClass = new Set<string>();

  for (const att of pendingAttendance) {
    const markedSet = new Set(att.markedStudentIds);
    const missingCount = att.eligibleStudentIds.filter((id) => !markedSet.has(id)).length;

    attendanceSetByClass.add(att.classId);

    const recipient = plan.get(att.effectiveTeacherId);
    if (recipient && (recipient.role === 'teacher' || recipient.role === 'admin')) {
      recipient.attendance.push({
        classId: att.classId,
        className: att.className,
        date: att.date,
        missingStudentCount: missingCount,
      });
    }
  }

  // 2. Process Course Closing
  const pendingCourseClosing = input.courseClosing.filter((cc) => {
    if (cc.snapshot.status === 'completed' || cc.snapshot.status === 'no_required_students') {
      return false;
    }
    const daysDiff = differenceInCalendarDays(parseISO(cc.endDate), digestDateObj);
    return daysDiff === 7 || daysDiff === 3 || daysDiff === 1;
  });

  for (const cc of pendingCourseClosing) {
    const recipient = plan.get(cc.primaryTeacherId);
    if (recipient && (recipient.role === 'teacher' || recipient.role === 'admin')) {
      recipient.courseClosing.push({
        classId: cc.classId,
        className: cc.className,
        endDate: cc.endDate,
        snapshotStatus: cc.snapshot.status,
      });
    }
  }

  // 3. Process Print Requests
  const pendingPrint = input.printRequests.filter((pr) => {
    return pr.status === 'pending' && pr.neededDate <= input.tomorrowDate;
  });

  for (const pr of pendingPrint) {
    const item: PrintReminderItem = {
      requestId: pr.requestId,
      className: pr.className,
      teacherName: pr.teacherName,
      neededDate: pr.neededDate,
      fileCount: pr.fileCount,
      totalCopies: pr.totalCopies,
    };

    // Give to all active office recipients
    for (const [staffId, recipient] of plan.entries()) {
      if (recipient.role === 'office') {
        recipient.printRequests.push({ ...item });
      }
    }
  }

  // 4. Admin Summary & Sorting & Cleanup
  const adminSummary: AdminDigestSummary = {
    linkedRecipients: input.sourceCounts.activeLinks,
    eligibleRecipients: input.sourceCounts.eligibleRecipients,
    missingAttendanceClasses: attendanceSetByClass.size, // Wait, requirement says "missingAttendanceClasses: number" but not precisely how to count it. Usually it's the number of unique classes. Let's count classes from `pendingAttendance`. Or is it just `pendingAttendance.length`? I'll use unique class count since it's "Classes".
    courseClosingClasses: pendingCourseClosing.length,
    pendingPrintRequests: pendingPrint.length,
    outstandingFailedMessages: input.sourceCounts.outstandingFailedMessages,
    potentialTruncation: input.sourceCounts.potentialTruncation || [],
  };

  // Pre-calculate unique classes for admin summary correctly:
  const uniqueMissingAttendanceClasses = new Set(pendingAttendance.map((a) => a.classId)).size;
  const uniqueCourseClosingClasses = new Set(pendingCourseClosing.map((c) => c.classId)).size;

  adminSummary.missingAttendanceClasses = uniqueMissingAttendanceClasses;
  adminSummary.courseClosingClasses = uniqueCourseClosingClasses;

  const finalPlan: ZaloBotDigestPlan = new Map();

  for (const [staffId, recipient] of plan.entries()) {
    // Admin always gets added, even if empty items
    if (recipient.role === 'admin') {
      recipient.adminSummary = { ...adminSummary };
      finalPlan.set(staffId, recipient);
      continue; // Admins are always kept
    }

    // Teacher/office recipients with no items are OMITTED from plan
    if (
      recipient.attendance.length > 0 ||
      recipient.courseClosing.length > 0 ||
      recipient.printRequests.length > 0
    ) {
      // Sort items by className then ID before finalizing
      recipient.attendance.sort(
        (a, b) =>
          a.className.localeCompare(b.className) ||
          a.classId.localeCompare(b.classId) ||
          a.date.localeCompare(b.date)
      );
      recipient.courseClosing.sort(
        (a, b) => a.className.localeCompare(b.className) || a.classId.localeCompare(b.classId)
      );
      recipient.printRequests.sort(
        (a, b) => a.className.localeCompare(b.className) || a.requestId.localeCompare(b.requestId)
      );

      finalPlan.set(staffId, recipient);
    }
  }

  // Also sort for admin
  for (const recipient of finalPlan.values()) {
    if (recipient.role === 'admin') {
      recipient.attendance.sort(
        (a, b) =>
          a.className.localeCompare(b.className) ||
          a.classId.localeCompare(b.classId) ||
          a.date.localeCompare(b.date)
      );
      recipient.courseClosing.sort(
        (a, b) => a.className.localeCompare(b.className) || a.classId.localeCompare(b.classId)
      );
      recipient.printRequests.sort(
        (a, b) => a.className.localeCompare(b.className) || a.requestId.localeCompare(b.requestId)
      );
    }
  }

  return finalPlan;
}
