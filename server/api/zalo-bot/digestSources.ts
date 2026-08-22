import type { DocumentStore } from '@/server/db/documentStore.js';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import type {
  DailyDigestRuleInput,
  ZaloBotDigestSourceCounts,
  ActiveZaloBotRecipient,
  AttendanceDigestSource,
  CourseClosingDigestSource,
  PrintDigestSource,
} from './digestTypes.js';
import { isExpectedClassSessionOnDate } from '../../../shared/classSchedule.js';
import { buildClassTerms } from '../../../shared/studentEnrollmentTimeline.js';
import { resolveAttendanceEligibilityBatch } from '../lib/attendance/sessionEligibility.js';
import { getEffectiveTeacherIdForSession } from '../../../shared/teacherAttendance.js';
import { computeCourseClosingSnapshot } from '../classes/helpers/courseClosing.js';
import { COURSE_TERM_ROSTER_STATUSES } from '../lib/student/courseTermRoster.js';

export const MAX_ACTIVE_CLASSES = 2_000;
export const MAX_DATE_ROWS = 5_000;
export const MAX_PENDING_PRINTS = 2_000;
export const MAX_ACTIVE_LINKS = 2_000;
export const MAX_FAILED_MESSAGES = 2_000;

const ZALO_NOTIFICATION_MESSAGE_TYPES = [
  'daily_digest',
  'link_confirmation',
  'test',
] as const;

function truncate<T>(
  items: T[],
  max: number,
  collection: string,
  potentialTruncation: string[]
): T[] {
  if (items.length > max) {
    if (!potentialTruncation.includes(collection)) potentialTruncation.push(collection);
    return items.slice(0, max);
  }
  return items;
}

async function runWithLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

const NOT_PRESENT_ELIGIBILITY = new Set(['not_enrolled', 'on_leave']);
const CLOSING_REMINDER_OFFSETS = new Set([7, 3, 1]);

export async function collectZaloBotDigestSources(
  db: DocumentStore,
  input: { digestDate: string; tomorrowDate: string }
): Promise<DailyDigestRuleInput> {
  const potentialTruncation: string[] = [];
  const digestDateObj = parseISO(input.digestDate);

  const [
    classesSnap,
    sessionsSnap,
    substitutesSnap,
    attendanceSnap,
    printsSnap,
    linksSnap,
    usersSnap,
    failedMessagesSnap,
  ] = await Promise.all([
    db
      .collection('classes')
      .limit(MAX_ACTIVE_CLASSES + 1)
      .get(),
    db
      .collection('class_sessions')
      .where('date', '==', input.digestDate)
      .limit(MAX_DATE_ROWS + 1)
      .get(),
    db
      .collection('substitute_requests')
      .where('date', '==', input.digestDate)
      .limit(MAX_DATE_ROWS + 1)
      .get(),
    db
      .collection('attendance')
      .where('date', '==', input.digestDate)
      .limit(MAX_DATE_ROWS + 1)
      .get(),
    db
      .collection('print_requests')
      .where('status', '==', 'pending')
      .where('neededDate', '<=', input.tomorrowDate)
      .limit(MAX_PENDING_PRINTS + 1)
      .get(),
    db
      .collection('zalo_bot_links')
      .where('status', '==', 'active')
      .limit(MAX_ACTIVE_LINKS + 1)
      .get(),
    db.collection('users').get(),
    db
      .collection('zalo_bot_messages')
      .where('status', '==', 'failed')
      .where('messageType', 'in', [...ZALO_NOTIFICATION_MESSAGE_TYPES])
      .limit(MAX_FAILED_MESSAGES + 1)
      .get(),
  ]);

  const rawClasses = truncate(classesSnap.docs, MAX_ACTIVE_CLASSES, 'classes', potentialTruncation);
  const rawSessions = truncate(
    sessionsSnap.docs,
    MAX_DATE_ROWS,
    'class_sessions',
    potentialTruncation
  );
  const rawSubstitutes = truncate(
    substitutesSnap.docs,
    MAX_DATE_ROWS,
    'substitute_requests',
    potentialTruncation
  );
  const rawAttendance = truncate(
    attendanceSnap.docs,
    MAX_DATE_ROWS,
    'attendance',
    potentialTruncation
  );
  const rawPrints = truncate(
    printsSnap.docs,
    MAX_PENDING_PRINTS,
    'print_requests',
    potentialTruncation
  );
  const rawLinks = truncate(
    linksSnap.docs,
    MAX_ACTIVE_LINKS,
    'zalo_bot_links',
    potentialTruncation
  );
  const rawFailedMessages = truncate(
    failedMessagesSnap.docs,
    MAX_FAILED_MESSAGES,
    'zalo_bot_messages',
    potentialTruncation
  );

  const usersById = new Map(usersSnap.docs.map((doc) => [doc.id, doc.data()]));
  const links = rawLinks.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));

  const activeRecipients: ActiveZaloBotRecipient[] = [];
  for (const link of links) {
    const user = usersById.get(String(link.staffId || ''));
    if (!user) continue;
    if (user.blockedTeacher === true) continue;
    const currentRole = String(user.role || '');
    if (!['teacher', 'office', 'admin'].includes(currentRole)) continue;
    if (currentRole !== String(link.role || '')) continue;

    activeRecipients.push({
      staffId: String(link.staffId || ''),
      role: currentRole as any,
      displayName: String(link.displayName || ''),
      chatIdHash: String(link.chatIdHash || ''),
    });
  }

  const sessionsByClassId = new Map(
    rawSessions.map((doc) => {
      const data = doc.data();
      return [String(data.classId || ''), data];
    })
  );

  const substitutesByClassId = new Map(
    rawSubstitutes.map((doc) => {
      const data = doc.data();
      return [String(data.classId || ''), data];
    })
  );

  const attendanceByClassId = new Map<string, any[]>();
  for (const doc of rawAttendance) {
    const data = doc.data();
    const classId = String(data.classId || '');
    if (!attendanceByClassId.has(classId)) attendanceByClassId.set(classId, []);
    attendanceByClassId.get(classId)!.push(data);
  }

  const attendanceDigest: AttendanceDigestSource[] = [];
  const courseClosingDigest: CourseClosingDigestSource[] = [];

  const classesToProcess = rawClasses.filter((doc) => {
    const data = doc.data();
    if (data.status === 'archived') return false;

    const session = sessionsByClassId.get(doc.id);
    if (session && (session.status === 'taught' || session.status === 'makeup')) return true;

    return isExpectedClassSessionOnDate(data as any, input.digestDate);
  });

  const classStudentMap = new Map<string, Set<string>>();
  const classTermMap = new Map<string, { termStart: string | null; termEnd: string | null }>();

  for (const doc of classesToProcess) {
    const data = doc.data();
    const classId = doc.id;
    const students = Array.isArray(data.students)
      ? data.students.map((s) => String(s?.id || s))
      : [];
    classStudentMap.set(classId, new Set(students.filter(Boolean)));

    const terms = buildClassTerms({ id: classId, ...data });
    const currentTerm =
      terms.find(
        (term) =>
          term.startDate <= input.digestDate && (!term.endDate || input.digestDate <= term.endDate)
      ) || terms.find((t) => t.isCurrent);
    classTermMap.set(classId, {
      termStart: currentTerm ? currentTerm.startDate : null,
      termEnd: currentTerm ? currentTerm.endDate || null : null,
    });
  }

  const enrollmentClassIds = [...classTermMap.entries()]
    .filter(([, term]) => Boolean(term.termStart))
    .map(([classId]) => classId);
  const enrollmentSnapshots = await runWithLimit(chunks(enrollmentClassIds, 30), 10, (classIds) =>
    db.collection('student_course_enrollments').where('classId', 'in', classIds).get()
  );
  const rosterStatuses = new Set<string>(COURSE_TERM_ROSTER_STATUSES);

  for (const snapshot of enrollmentSnapshots) {
    for (const enrollmentDoc of snapshot.docs) {
      const enrollment = enrollmentDoc.data();
      const classId = String(enrollment.classId || '');
      const studentId = String(enrollment.studentId || '');
      const term = classTermMap.get(classId);
      if (
        !studentId ||
        !term?.termStart ||
        String(enrollment.termStart || '') !== term.termStart ||
        !rosterStatuses.has(String(enrollment.status || ''))
      ) {
        continue;
      }
      classStudentMap.get(classId)?.add(studentId);
    }
  }

  const studentsToFetch = new Set<string>();
  for (const students of classStudentMap.values()) {
    for (const studentId of students) studentsToFetch.add(studentId);
  }

  const studentIds = Array.from(studentsToFetch);
  const studentsById = new Map<string, any>();
  for (let i = 0; i < studentIds.length; i += 300) {
    const chunk = studentIds.slice(i, i + 300);
    const refs = chunk.map((id) => db.collection('students').doc(id));
    if (refs.length > 0) {
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap) => {
        if (snap.exists) studentsById.set(snap.id, snap.data());
      });
    }
  }

  const courseClosingCandidateClasses = rawClasses.filter((doc) => {
    const data = doc.data();
    if (data.status === 'archived') return false;
    const endDate = String(data.endDate || '');
    if (!endDate) return false;
    const diff = differenceInCalendarDays(parseISO(input.digestDate), parseISO(endDate));
    return diff === -7 || diff === -3 || diff === -1;
  });

  const courseClosingSnapshots = await runWithLimit(
    courseClosingCandidateClasses,
    10,
    async (doc) => {
      const snapshot = await computeCourseClosingSnapshot(db, doc.id);
      return { doc, snapshot };
    }
  );

  for (const item of courseClosingSnapshots) {
    const { doc, snapshot } = item;
    const data = doc.data();
    courseClosingDigest.push({
      classId: doc.id,
      className: String(data.name || ''),
      primaryTeacherId: String(data.teacherId || ''),
      endDate: String(data.endDate || ''),
      snapshot,
    });
  }

  for (const doc of classesToProcess) {
    const classId = doc.id;
    const data = doc.data();
    const session = sessionsByClassId.get(classId);
    const substitute = substitutesByClassId.get(classId);

    const effectiveTeacherId = getEffectiveTeacherIdForSession({
      acceptedSubstituteTeacherId:
        substitute?.status === 'accepted' ? substitute.substituteTeacherId : null,
      sessionTeacherId: session?.teacherId,
      classTeacherId: data.teacherId,
    });

    const students = [...(classStudentMap.get(classId) || [])];
    const termInfo = classTermMap.get(classId)!;

    const studentsMap = new Map<string, any>();
    for (const s of students) {
      if (studentsById.has(s)) studentsMap.set(s, studentsById.get(s)!);
    }

    const eligibilityMap = await resolveAttendanceEligibilityBatch(db, {
      classId,
      termStart: termInfo.termStart,
      termEnd: termInfo.termEnd,
      date: input.digestDate,
      studentsById: studentsMap,
    });

    const eligibleStudentIds: string[] = [];
    for (const [sId, res] of eligibilityMap.entries()) {
      if (res.eligibility !== 'not_enrolled' && res.eligibility !== 'on_leave') {
        eligibleStudentIds.push(sId);
      }
    }

    const classAttendance = attendanceByClassId.get(classId) || [];
    const markedStudentIds = classAttendance.map((a) => String(a.studentId || ''));

    attendanceDigest.push({
      classId,
      className: String(data.name || ''),
      date: input.digestDate,
      scheduled: isExpectedClassSessionOnDate(data as any, input.digestDate),
      sessionStatus: session?.status || 'unconfirmed',
      primaryTeacherId: String(data.teacherId || ''),
      effectiveTeacherId,
      eligibleStudentIds,
      markedStudentIds,
    });
  }

  const printRequests: PrintDigestSource[] = rawPrints.map((doc) => {
    const data = doc.data();
    return {
      requestId: doc.id,
      className: String(data.className || ''),
      teacherName: String(data.teacherName || ''),
      neededDate: String(data.neededDate || ''),
      status: data.status as any,
      fileCount: Array.isArray(data.files) ? data.files.length : 0,
      totalCopies: Number(data.totalCopies || 0),
    };
  });

  return {
    digestDate: input.digestDate,
    tomorrowDate: input.tomorrowDate,
    activeRecipients,
    attendance: attendanceDigest,
    courseClosing: courseClosingDigest,
    printRequests,
    sourceCounts: {
      classes: classesToProcess.length,
      sessions: rawSessions.length,
      attendanceRows: rawAttendance.length,
      printRequests: rawPrints.length,
      activeLinks: rawLinks.length,
      eligibleRecipients: activeRecipients.length,
      outstandingFailedMessages: rawFailedMessages.length,
      potentialTruncation,
    },
  };
}
