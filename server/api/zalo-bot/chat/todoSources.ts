import type { DocumentStore } from '@/server/db/documentStore.js';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { UserContext } from '../../lib/auth/authz.js';
import { assertClassAccess } from '../../lib/auth/authz.js';
import type {
  DailyDigestRuleInput,
  AttendanceDigestSource,
  CourseClosingDigestSource,
  PrintDigestSource,
} from '../digestTypes.js';
import { isExpectedClassSessionOnDate } from '../../../../shared/classSchedule.js';
import { buildClassTerms } from '../../../../shared/studentEnrollmentTimeline.js';
import { resolveAttendanceEligibilityBatch } from '../../lib/attendance/sessionEligibility.js';
import { listCanonicalClassRoster } from '../../lib/student/canonicalStudentReadRepository.js';
import { computeCourseClosingSnapshot } from '../../classes/helpers/courseClosing.js';
import { listAuthorizedClasses } from './classResolver.js';
import type { ZaloBotStaffRole } from '../../../../shared/zaloBot.js';

const NOT_PRESENT_ELIGIBILITY = new Set(['not_enrolled', 'on_leave']);
const CLOSING_REMINDER_OFFSETS = new Set([7, 3, 1]);
const MAX_PENDING_PRINTS = 200;

async function assertTodoClassAccess(
  db: DocumentStore,
  actor: UserContext,
  classId: string,
  className: string
): Promise<Record<string, unknown> | null> {
  try {
    return await assertClassAccess(db, actor, classId, 'read');
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 403) {
      console.warn('[zaloBotChat] todo class denied after authorized listing', {
        uid: actor.uid,
        classId,
        className,
      });
    }
    if (statusCode === 403 || statusCode === 404) return null;
    throw err;
  }
}

/**
 * Nguồn dữ liệu cho "việc cần làm của tôi", hẹp theo một người hỏi.
 *
 * collectZaloBotDigestSources đọc toàn bộ classes và toàn bộ users vì nó phục
 * vụ mọi người nhận trong một lần chạy cron. Một câu chat chỉ cần lớp của một
 * người, nên phần đọc được viết lại; phần luật vẫn là buildZaloBotDigestPlan.
 */
export async function collectZaloBotChatTodoSources(
  db: DocumentStore,
  actor: UserContext,
  input: { digestDate: string; tomorrowDate: string }
): Promise<DailyDigestRuleInput> {
  // digestRules chỉ giao attendance/course-closing cho teacher/admin. Office chỉ
  // nhận print requests, nên đọc toàn bộ lớp ở đây vừa không đổi câu trả lời vừa
  // tạo N+1 query rất lớn cho một câu chat.
  const authorized = actor.role === 'office' ? [] : await listAuthorizedClasses(db, actor);
  const digestDateObj = parseISO(input.digestDate);

  const attendance: AttendanceDigestSource[] = [];
  const courseClosing: CourseClosingDigestSource[] = [];
  let sessionRowsRead = 0;
  let attendanceRowsRead = 0;

  for (const row of authorized) {
    // Chốt chặn 3: collector không tin riêng kết quả listAuthorizedClasses.
    // Dùng class data vừa được assert để tránh tiếp tục bằng snapshot cũ.
    const checkedClass = await assertTodoClassAccess(
      db,
      actor,
      row.classId,
      row.className
    );
    if (!checkedClass) continue;

    const sessionsSnap = await db
      .collection('class_sessions')
      .where('classId', '==', row.classId)
      .where('date', '==', input.digestDate)
      .get();
    sessionRowsRead += sessionsSnap.size;
    const session = sessionsSnap.docs[0]?.data() || null;
    const sessionStatus = String(session?.status || 'unconfirmed');
    const scheduled = isExpectedClassSessionOnDate(checkedClass as never, input.digestDate);

    if (scheduled || sessionStatus === 'taught' || sessionStatus === 'makeup') {
      const terms = buildClassTerms({ id: row.classId, ...checkedClass } as never);
      const currentTerm =
        terms.find(
          (term) =>
            term.startDate <= input.digestDate &&
            (!term.endDate || input.digestDate <= term.endDate)
        ) || terms.find((term) => term.isCurrent);

      const roster = await listCanonicalClassRoster(db, {
        classId: row.classId,
        atDate: input.digestDate,
      });
      const studentsById = new Map<string, Record<string, unknown>>(
        roster.map((item) => [
          item.canonicalProfileId,
          { ...(item.profile as Record<string, unknown>), id: item.canonicalProfileId },
        ])
      );

      const eligibility = await resolveAttendanceEligibilityBatch(db, {
        classId: row.classId,
        termStart: currentTerm ? currentTerm.startDate : null,
        termEnd: currentTerm ? currentTerm.endDate || null : null,
        date: input.digestDate,
        studentsById,
      });

      const eligibleStudentIds: string[] = [];
      for (const [studentId, resolution] of eligibility.entries()) {
        if (!NOT_PRESENT_ELIGIBILITY.has(resolution.eligibility)) {
          eligibleStudentIds.push(studentId);
        }
      }

      const attendanceSnap = await db
        .collection('attendance')
        .where('classId', '==', row.classId)
        .where('date', '==', input.digestDate)
        .get();
      attendanceRowsRead += attendanceSnap.size;
      const markedStudentIds = attendanceSnap.docs
        .map((doc) => String(doc.data()?.studentId || ''))
        .filter(Boolean);

      attendance.push({
        classId: row.classId,
        className: row.className,
        date: input.digestDate,
        scheduled,
        sessionStatus: sessionStatus as AttendanceDigestSource['sessionStatus'],
        primaryTeacherId: String(checkedClass.teacherId || ''),
        // Câu hỏi là "việc của tôi", nên người hỏi là người chịu trách nhiệm
        // cho lớp của chính họ trong bối cảnh này.
        effectiveTeacherId: actor.uid,
        eligibleStudentIds,
        markedStudentIds,
      });
    }

    const endDate = String(checkedClass.endDate || '');
    if (endDate) {
      const offset = differenceInCalendarDays(parseISO(endDate), digestDateObj);
      if (CLOSING_REMINDER_OFFSETS.has(offset)) {
        const snapshot = await computeCourseClosingSnapshot(db, row.classId);
        courseClosing.push({
          classId: row.classId,
          className: row.className,
          primaryTeacherId: actor.uid,
          endDate,
          snapshot,
        });
      }
    }
  }

  const printRequests: PrintDigestSource[] = [];
  if (actor.role === 'office' || actor.role === 'admin') {
    const printsSnap = await db
      .collection('print_requests')
      .where('status', '==', 'pending')
      .limit(MAX_PENDING_PRINTS + 1)
      .get();
    if (printsSnap.size > MAX_PENDING_PRINTS) {
      throw new Error(`[zaloBotChat] pending print set exceeds ${MAX_PENDING_PRINTS} rows`);
    }
    for (const doc of printsSnap.docs) {
      const data = doc.data() || {};
      const neededDate = String(data.neededDate || '');
      // Lọc trong bộ nhớ: `<=` trên DocumentStore cần index ghép, và
      // createInMemoryDocumentStore không hỗ trợ toán tử đó.
      if (neededDate === '' || neededDate > input.tomorrowDate) continue;
      printRequests.push({
        requestId: doc.id,
        className: String(data.className || ''),
        teacherName: String(data.teacherName || ''),
        neededDate,
        status: data.status as PrintDigestSource['status'],
        fileCount: Array.isArray(data.files) ? data.files.length : 0,
        totalCopies: Number(data.totalCopies || 0),
      });
    }
  }

  return {
    digestDate: input.digestDate,
    tomorrowDate: input.tomorrowDate,
    activeRecipients: [
      {
        staffId: actor.uid,
        role: actor.role as ZaloBotStaffRole,
        displayName: actor.name,
        chatIdHash: '',
      },
    ],
    attendance,
    courseClosing,
    printRequests,
    sourceCounts: {
      classes: authorized.length,
      sessions: sessionRowsRead,
      attendanceRows: attendanceRowsRead,
      printRequests: printRequests.length,
      activeLinks: 1,
      eligibleRecipients: 1,
      outstandingFailedMessages: 0,
      potentialTruncation: [],
    },
  };
}
