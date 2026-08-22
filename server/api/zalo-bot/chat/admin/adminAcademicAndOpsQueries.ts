import type { DocumentStore } from '@/server/db/documentStore.js';
import { resolvePeriodBounds } from '../../../../../shared/adminChatMetrics.js';
import { buildClassTerms } from '../../../../../shared/studentEnrollmentTimeline.js';
import { readStoredStudentCourseEnrollment } from '../../../lib/student/courseEnrollmentRepository.js';
import { calculateCurrentCourseAttendance } from '../../../read/handlers/attendanceStudentQuickProfileSummary.js';
import type {
  AdminAcademicEvaluationItem,
  AdminAcademicResult,
  AdminDataQuality,
  AdminDataQualityIssue,
  AdminZaloOperationsResult,
} from './adminChatTypes.js';
import type { ResolvedCanonicalStudent } from './adminEntityResolver.js';
import { getStudentIdentityEquivalenceSet } from './adminTuitionQueries.js';

const MAX_ACADEMIC_EVALUATIONS = 20;
const MAX_ACADEMIC_SUBMISSIONS = 50;
const MAX_ACADEMIC_ATTENDANCE = 5_000;
const MAX_ACADEMIC_SESSIONS = 5_000;
const MAX_ZALO_OPERATION_ROWS = 1_000;
const ZALO_STALE_MESSAGE_MS = 5 * 60 * 1_000;

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 5);
  }
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? [text] : [];
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Reads bounded, canonical academic evidence for one resolved student. */
export async function queryAdminStudentAcademic(
  db: DocumentStore,
  student: ResolvedCanonicalStudent,
  now = new Date()
): Promise<AdminAcademicResult> {
  const computedAt = now.toISOString();
  const studentIds = await getStudentIdentityEquivalenceSet(db, student.id);
  const currentClassId = student.currentClassId;
  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';

  const [
    evalsSnap,
    submissionsSnap,
    classSnap,
    studentSnap,
    enrollmentSnap,
    attendanceSnap,
    sessionSnap,
  ] = await Promise.all([
    db
      .collection('evaluations')
      .where('studentId', 'in', studentIds)
      .limit(MAX_ACADEMIC_EVALUATIONS + 1)
      .get(),
    db
      .collection('submissions')
      .where('studentId', 'in', studentIds)
      .limit(MAX_ACADEMIC_SUBMISSIONS + 1)
      .get(),
    currentClassId ? db.collection('classes').doc(currentClassId).get() : Promise.resolve(null),
    db.collection('students').doc(student.id).get(),
    currentClassId
      ? db
          .collection('student_course_enrollments')
          .where('studentId', '==', student.id)
          .where('classId', '==', currentClassId)
          .limit(21)
          .get()
      : Promise.resolve(null),
    currentClassId
      ? db
          .collection('attendance')
          .where('studentId', 'in', studentIds)
          .where('classId', '==', currentClassId)
          .limit(MAX_ACADEMIC_ATTENDANCE + 1)
          .get()
      : Promise.resolve(null),
    currentClassId
      ? db
          .collection('class_sessions')
          .where('classId', '==', currentClassId)
          .limit(MAX_ACADEMIC_SESSIONS + 1)
          .get()
      : Promise.resolve(null),
  ]);

  if (
    evalsSnap.docs.length > MAX_ACADEMIC_EVALUATIONS ||
    submissionsSnap.docs.length > MAX_ACADEMIC_SUBMISSIONS ||
    Boolean(attendanceSnap && attendanceSnap.docs.length > MAX_ACADEMIC_ATTENDANCE) ||
    Boolean(sessionSnap && sessionSnap.docs.length > MAX_ACADEMIC_SESSIONS)
  ) {
    qualityStatus = 'failed';
    issues.push({ code: 'result_cap_reached', source: 'academic_sources' });
  }

  const evaluations: AdminAcademicEvaluationItem[] = evalsSnap.docs
    .slice(0, MAX_ACADEMIC_EVALUATIONS)
    .map((doc) => doc.data() || {})
    .filter(
      (data) =>
        data.isDeleted !== true &&
        data.isVoided !== true &&
        (!currentClassId || String(data.classId || '') === currentClassId)
    )
    .sort((a, b) =>
      String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || ''))
    )
    .slice(0, 5)
    .map((data) => {
      const evaluationType = String(data.evaluationType || '').toLowerCase();
      return {
        termLabel: String(data.termLabel || data.courseLabel || data.termName || 'Khóa hiện tại'),
        type: evaluationType === 'final' ? 'final' : 'midterm',
        score:
          finiteNumber(data.finalScore) ??
          finiteNumber(data.totalScore) ??
          finiteNumber(data.testScore) ??
          finiteNumber(data.midtermScore),
        rank: typeof data.rank === 'string' && data.rank.trim() ? data.rank.trim() : null,
        strengths: [
          ...stringList(data.positivePoints),
          ...stringList(data.comment),
          ...stringList(data.feedback),
        ].slice(0, 5),
        improvements: stringList(data.improvementPoints),
        date: typeof data.date === 'string' ? data.date : null,
      };
    });

  const latestSubmissionByAssignment = new Map<string, Record<string, unknown>>();
  for (const doc of submissionsSnap.docs.slice(0, MAX_ACADEMIC_SUBMISSIONS)) {
    const data = doc.data() || {};
    if (
      data.isDeleted === true ||
      data.status !== 'graded' ||
      (currentClassId && String(data.classId || '') !== currentClassId)
    ) {
      continue;
    }
    const assignmentId = String(data.assignmentId || '');
    if (!assignmentId) continue;
    const existing = latestSubmissionByAssignment.get(assignmentId);
    if (
      !existing ||
      String(data.submittedAt || '').localeCompare(String(existing.submittedAt || '')) > 0
    ) {
      latestSubmissionByAssignment.set(assignmentId, data);
    }
  }

  const assignmentIds = [...latestSubmissionByAssignment.keys()].slice(0, 20);
  const assignmentSnaps = assignmentIds.length
    ? await db.getAll(...assignmentIds.map((id) => db.collection('assignments').doc(id)))
    : [];
  const assignmentById = new Map(
    assignmentSnaps
      .filter((snap) => snap.exists && snap.data()?.isDeleted !== true)
      .map((snap) => [snap.id, snap.data() || {}])
  );
  if (assignmentById.size !== assignmentIds.length) {
    qualityStatus = qualityStatus === 'failed' ? 'failed' : 'degraded';
    issues.push({ code: 'source_incomplete', source: 'assignments' });
  }
  const assignments = assignmentIds.slice(0, 5).flatMap((assignmentId) => {
    const assignment = assignmentById.get(assignmentId);
    const submission = latestSubmissionByAssignment.get(assignmentId);
    if (!assignment || !submission) return [];
    return [
      {
        title: String(assignment.title || assignment.name || assignmentId),
        score: finiteNumber(submission.grade),
        maxScore: finiteNumber(assignment.maxScore) ?? finiteNumber(assignment.totalPoints) ?? 100,
        submittedAt: typeof submission.submittedAt === 'string' ? submission.submittedAt : null,
      },
    ];
  });

  let attendanceSummary: AdminAcademicResult['attendanceSummary'];
  if (currentClassId && classSnap?.exists && studentSnap.exists && attendanceSnap && sessionSnap) {
    const classData = classSnap.data() || {};
    const currentTerm = buildClassTerms({ id: currentClassId, ...classData }).find(
      (term) => term.isCurrent
    );
    const enrollment =
      enrollmentSnap?.docs
        .map((doc) => readStoredStudentCourseEnrollment(doc))
        .find((row) => row.termStart === currentTerm?.startDate) ?? null;
    const attendance = attendanceSnap.docs
      .slice(0, MAX_ACADEMIC_ATTENDANCE)
      .map((doc) => doc.data() || {})
      .filter((data) => data.isVoided !== true)
      .map((data) => ({
        classId: currentClassId,
        date: String(data.date || ''),
        status: typeof data.status === 'string' ? data.status : undefined,
        permission: data.permission === true,
        minutesLate: Number(data.minutesLate || 0),
      }));
    const classSessions = sessionSnap.docs.slice(0, MAX_ACADEMIC_SESSIONS).map((doc) => {
      const data = doc.data() || {};
      return {
        classId: currentClassId,
        date: String(data.date || ''),
        status: String(data.status || ''),
      };
    });
    const summary = calculateCurrentCourseAttendance({
      classData: { id: currentClassId, ...classData },
      studentData: studentSnap.data() || {},
      enrollment,
      attendance,
      classSessions,
    });
    if (summary) {
      attendanceSummary = {
        totalSessions: summary.totalSessions,
        presentSessions: summary.attendedSessions,
        absentSessions: attendance.filter((row) => row.status === 'absent').length,
      };
    } else if (qualityStatus !== 'failed') {
      qualityStatus = 'degraded';
      issues.push({ code: 'source_incomplete', source: 'attendance' });
    }
  } else if (qualityStatus !== 'failed') {
    qualityStatus = 'degraded';
    issues.push({ code: 'source_incomplete', source: 'attendance' });
  }

  return {
    kind: 'student_academic',
    student: {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      className: student.currentClassName,
    },
    evaluations,
    assignments,
    attendanceSummary,
    quality: { status: qualityStatus, issues },
    computedAt,
    source: 'canonical_student_academic_v2',
  };
}

/** Reads operational metadata only; message contents and chat identifiers are never selected. */
export async function queryAdminZaloOperations(
  db: DocumentStore,
  options: { period?: string | null },
  now = new Date()
): Promise<AdminZaloOperationsResult> {
  const computedAt = now.toISOString();
  const period = resolvePeriodBounds(options.period, now);
  const startIso = new Date(`${period.startDate}T00:00:00+07:00`).toISOString();
  const endExclusive = new Date(`${period.endDate}T00:00:00+07:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endExclusiveIso = endExclusive.toISOString();

  const [messagesSnap, linksSnap] = await Promise.all([
    db
      .collection('zalo_bot_messages')
      .where('createdAt', '>=', startIso)
      .where('createdAt', '<', endExclusiveIso)
      .select(
        'status',
        'errorCode',
        'createdAt',
        'updatedAt',
        'processingStartedAt',
        'nextAttemptAt',
        'deliveryAmbiguous'
      )
      .limit(MAX_ZALO_OPERATION_ROWS + 1)
      .get(),
    db
      .collection('zalo_bot_links')
      .select('status')
      .limit(MAX_ZALO_OPERATION_ROWS + 1)
      .get(),
  ]);

  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';
  if (
    messagesSnap.docs.length > MAX_ZALO_OPERATION_ROWS ||
    linksSnap.docs.length > MAX_ZALO_OPERATION_ROWS
  ) {
    qualityStatus = 'failed';
    issues.push({ code: 'result_cap_reached', source: 'zalo_operations' });
  }

  let totalSent = 0;
  let totalFailed = 0;
  let totalPending = 0;
  let stalePending = 0;
  let staleProcessing = 0;
  let retryQueue = 0;
  const errorCounts = new Map<string, number>();
  const staleCutoff = now.getTime() - ZALO_STALE_MESSAGE_MS;

  for (const doc of messagesSnap.docs.slice(0, MAX_ZALO_OPERATION_ROWS)) {
    const data = doc.data() || {};
    const status = String(data.status || '');
    if (status === 'sent' || status === 'delivered') {
      totalSent++;
    } else if (status === 'failed') {
      totalFailed++;
      const errorCode = String(data.errorCode || 'unknown');
      errorCounts.set(errorCode, (errorCounts.get(errorCode) || 0) + 1);
      const nextAttemptAt = Date.parse(String(data.nextAttemptAt || ''));
      if (!Number.isFinite(nextAttemptAt) || nextAttemptAt <= now.getTime()) retryQueue++;
    } else if (status === 'pending' || status === 'retrying') {
      totalPending++;
      const updatedAt = Date.parse(String(data.updatedAt || data.createdAt || ''));
      if (Number.isFinite(updatedAt) && updatedAt <= staleCutoff) stalePending++;
      retryQueue++;
    } else if (status === 'processing') {
      totalPending++;
      const startedAt = Date.parse(
        String(data.processingStartedAt || data.updatedAt || data.createdAt || '')
      );
      if (Number.isFinite(startedAt) && startedAt <= staleCutoff) staleProcessing++;
    }
  }

  const linkCounts = { active: 0, disabled: 0, needsRelink: 0, pendingCount: 0 };
  for (const doc of linksSnap.docs.slice(0, MAX_ZALO_OPERATION_ROWS)) {
    const status = String(doc.data()?.status || '');
    if (status === 'active') linkCounts.active++;
    else if (status === 'disabled') linkCounts.disabled++;
    else if (status === 'needs_relink') linkCounts.needsRelink++;
    else linkCounts.pendingCount++;
  }

  const totalMessages = totalSent + totalFailed + totalPending;
  return {
    kind: 'zalo_operations',
    period,
    links: linkCounts,
    messages: {
      total: totalMessages,
      sent: totalSent,
      failed: totalFailed,
      sentRate: totalMessages > 0 ? totalSent / totalMessages : 1,
    },
    topErrors: [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([errorCode, count]) => ({ errorCode, count })),
    backlogs: { stalePending, staleProcessing, retryQueue },
    quality: { status: qualityStatus, issues },
    computedAt,
    source: 'zalo_bot_operations_v2',
  };
}
