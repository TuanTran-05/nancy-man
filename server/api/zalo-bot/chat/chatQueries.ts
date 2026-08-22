import type { DocumentStore } from '@/server/db/documentStore.js';
import { addDays, format, parseISO } from 'date-fns';
import { buildZaloBotDigestPlan } from '../digestRules.js';
import { collectZaloBotChatTodoSources } from './todoSources.js';
import type { UserContext } from '../../lib/auth/authz.js';
import { assertClassAccess } from '../../lib/auth/authz.js';
import { listCanonicalClassRoster } from '../../lib/student/canonicalStudentReadRepository.js';
import { listCanonicalClassRosterProfiles } from '../../lib/student/canonicalClassRoster.js';
import type { ZaloBotChatAnswer } from './chatTypes.js';

import { resolveAttendanceEligibilityBatch } from '../../lib/attendance/sessionEligibility.js';
import { isExpectedClassSessionOnDate } from '../../../../shared/classSchedule.js';
import { buildClassTerms } from '../../../../shared/studentEnrollmentTimeline.js';
import { listAuthorizedClasses } from './classResolver.js';

export type ZaloBotChatTarget = { classId: string; className: string };

export const ZALO_BOT_CHAT_MAX_LISTED_STUDENTS = 40;

/**
 * Kiểm quyền lần thứ hai, độc lập với bước giải tên lớp.
 *
 * classResolver đã lọc theo tập được phép, nên tới đây mà 403 nghĩa là
 * resolver đã hỏng. Ghi cảnh báo để lỗi đó không im lặng, còn người dùng vẫn
 * nhận đúng câu "không tìm thấy" — không tiết lộ sự tồn tại của lớp.
 */
async function ensureAccess(
  db: DocumentStore,
  actor: UserContext,
  target: ZaloBotChatTarget
): Promise<Record<string, unknown> | null> {
  try {
    return await assertClassAccess(db, actor, target.classId, 'read');
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 403) {
      console.warn('[zaloBotChat] class access denied after resolver allowed it', {
        uid: actor.uid,
        classId: target.classId,
      });
    }
    if (statusCode === 403 || statusCode === 404) return null;
    // Lỗi DocumentStore/vận hành không được giả làm "không tìm thấy". Ném tiếp để
    // error boundary của chatService gửi xin lỗi và ghi errorCode vào ledger.
    throw err;
  }
}

export async function runClassStudentCount(
  db: DocumentStore,
  actor: UserContext,
  target: ZaloBotChatTarget
): Promise<ZaloBotChatAnswer> {
  if (!(await ensureAccess(db, actor, target))) {
    return { kind: 'class_not_found', hint: target.className };
  }

  // Không dùng field cache classes.studentCounts: nó được cộng trừ theo delta
  // qua applyClassStudentCountDeltas nên có thể trôi khỏi thực tế. Roster đọc
  // thẳng student_course_enrollments và mặc định chỉ tính enrollment đang mở
  // (trial | active | on_leave).
  const rows = await listCanonicalClassRoster(db, { classId: target.classId });

  let active = 0;
  let onLeave = 0;
  let trial = 0;

  for (const row of rows) {
    const status = row.currentEnrollment?.status ?? row.scopedEnrollment?.status ?? null;
    if (status === 'active') active += 1;
    else if (status === 'on_leave') onLeave += 1;
    else if (status === 'trial') trial += 1;
  }

  return { kind: 'student_count', className: target.className, active, onLeave, trial };
}

export async function runClassStudentList(
  db: DocumentStore,
  actor: UserContext,
  target: ZaloBotChatTarget
): Promise<ZaloBotChatAnswer> {
  if (!(await ensureAccess(db, actor, target))) {
    return { kind: 'class_not_found', hint: target.className };
  }

  const profiles = await listCanonicalClassRosterProfiles(db, target.classId);
  const names = profiles
    .map((profile) => profile.name)
    .filter((name) => name !== '')
    .sort((left, right) => left.localeCompare(right, 'vi'));

  return {
    kind: 'student_list',
    className: target.className,
    names: names.slice(0, ZALO_BOT_CHAT_MAX_LISTED_STUDENTS),
    omitted: Math.max(0, names.length - ZALO_BOT_CHAT_MAX_LISTED_STUDENTS),
  };
}

function readValidDateOnly(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;

  const parsed = parseISO(candidate);
  if (Number.isNaN(parsed.getTime()) || format(parsed, 'yyyy-MM-dd') !== candidate) return null;
  return candidate;
}

export async function runClassEndDate(
  db: DocumentStore,
  actor: UserContext,
  target: ZaloBotChatTarget
): Promise<ZaloBotChatAnswer> {
  const checkedClass = await ensureAccess(db, actor, target);
  if (!checkedClass) {
    return { kind: 'class_not_found', hint: target.className };
  }

  return {
    kind: 'class_end_date',
    className: target.className,
    endDate: readValidDateOnly(checkedClass.endDate),
  };
}

const NOT_PRESENT_ELIGIBILITY = new Set(['not_enrolled', 'on_leave']);

export async function runAttendanceToday(
  db: DocumentStore,
  actor: UserContext,
  date: string
): Promise<ZaloBotChatAnswer> {
  const authorized = await listAuthorizedClasses(db, actor);
  if (authorized.length === 0) {
    return { kind: 'attendance_today', date, classes: [] };
  }

  const classes: Array<{
    className: string;
    eligible: number;
    marked: number;
    missing: number;
  }> = [];

  for (const row of authorized) {
    // Chốt chặn 3 áp dụng cả với executor nhiều lớp. Không đọc roster hay
    // attendance trước khi class document đã được assert lại độc lập.
    const checkedClass = await ensureAccess(db, actor, {
      classId: row.classId,
      className: row.className,
    });
    if (!checkedClass) continue;

    const sessionsSnap = await db
      .collection('class_sessions')
      .where('classId', '==', row.classId)
      .where('date', '==', date)
      .get();
    const sessionStatuses = new Set(
      sessionsSnap.docs.map((doc) => String(doc.data()?.status || 'unconfirmed'))
    );
    const explicitlyHeld = sessionStatuses.has('taught') || sessionStatuses.has('makeup');
    const explicitlyCancelled = sessionStatuses.has('cancelled');
    const scheduled = isExpectedClassSessionOnDate(checkedClass as never, date);
    if (!explicitlyHeld && (!scheduled || explicitlyCancelled)) continue;

    const terms = buildClassTerms({ id: row.classId, ...checkedClass } as never);
    const currentTerm =
      terms.find((term) => term.startDate <= date && (!term.endDate || date <= term.endDate)) ||
      terms.find((term) => term.isCurrent);

    const roster = await listCanonicalClassRoster(db, { classId: row.classId, atDate: date });
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
      date,
      studentsById,
    });

    const eligibleIds: string[] = [];
    for (const [studentId, resolution] of eligibility.entries()) {
      if (!NOT_PRESENT_ELIGIBILITY.has(resolution.eligibility)) eligibleIds.push(studentId);
    }

    // Không query toàn bộ attendance của trung tâm theo ngày. Index
    // attendance(classId, date) đã có trong documentStore.indexes.json.
    const attendanceSnap = await db
      .collection('attendance')
      .where('classId', '==', row.classId)
      .where('date', '==', date)
      .get();
    const marked = new Set<string>(
      attendanceSnap.docs.map((doc) => String(doc.data()?.studentId || '')).filter(Boolean)
    );
    const markedCount = eligibleIds.filter((studentId) => marked.has(studentId)).length;

    classes.push({
      className: row.className,
      eligible: eligibleIds.length,
      marked: markedCount,
      missing: eligibleIds.length - markedCount,
    });
  }

  classes.sort((left, right) => left.className.localeCompare(right.className, 'vi'));

  return { kind: 'attendance_today', date, classes };
}

export async function runMyTodo(
  db: DocumentStore,
  actor: UserContext,
  date: string
): Promise<ZaloBotChatAnswer> {
  const tomorrowDate = format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
  const sources = await collectZaloBotChatTodoSources(db, actor, {
    digestDate: date,
    tomorrowDate,
  });

  const plan = buildZaloBotDigestPlan(sources);
  const recipient = plan.get(actor.uid);

  if (!recipient) {
    return { kind: 'my_todo', attendance: [], courseClosing: [], printRequests: [] };
  }

  // digestRules giao chi tiết print cho office; admin chỉ nhận adminSummary.
  // Chat v1 cần danh sách việc có thể hành động, nên admin lấy cùng nguồn in đã
  // được collector cho phép thay vì phơi toàn bộ adminSummary vận hành.
  const printItems = actor.role === 'admin' ? sources.printRequests : recipient.printRequests;

  return {
    kind: 'my_todo',
    attendance: recipient.attendance.map((item) => ({
      className: item.className,
      missingStudentCount: item.missingStudentCount,
    })),
    courseClosing: recipient.courseClosing.map((item) => ({
      className: item.className,
      endDate: item.endDate,
    })),
    printRequests: printItems.map((item) => ({
      className: item.className,
      teacherName: item.teacherName,
      neededDate: item.neededDate,
      fileCount: item.fileCount,
      totalCopies: item.totalCopies,
    })),
  };
}
