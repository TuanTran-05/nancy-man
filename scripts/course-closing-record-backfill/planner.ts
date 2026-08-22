import {
  isCurrentAcademicCourseRecord,
  isRequiredAcademicEvaluationStudent,
  selectFinalEvaluation,
  selectMidtermEvaluation,
} from '../../shared/academic.js';
import {
  COURSE_CLOSING_DOCX_MIME,
  COURSE_CLOSING_RECORD_VERSION,
  COURSE_CLOSING_TEMPLATE_VERSION,
  closingMonthFromCourseEnd,
  courseClosingRecordId,
  normalizeSearchText,
  type ClosingDocumentType,
  type ClosingStoredDocument,
  type CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';
import {
  buildEvaluationArchiveSnapshot,
  buildTuitionArchiveSnapshot,
} from '../../server/api/classes/records/courseClosingRecordSnapshots.js';
import { normalizeArchiveDateOnly } from '../../server/api/classes/records/courseClosingRecordSources.js';
import type {
  BackfillDecisionKind,
  BackfillPlanItem,
  BackfillReasonCode,
  BackfillRunPlan,
  BackfillSourceBundle,
  BackfillSourceDoc,
} from './types.js';

const TUITION_NOTIFICATION_TYPES = new Set(['tuition_notice', 'next_course_tuition']);

function text(value: unknown): string {
  return String(value || '').trim();
}

function firstText(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(data[key]);
    if (value) return value;
  }
  return '';
}

function firstFinite(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = data[key];
    if (
      raw === null ||
      raw === undefined ||
      typeof raw === 'boolean' ||
      (typeof raw === 'string' && raw.trim() === '')
    ) {
      continue;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function emptyDocument(type: ClosingDocumentType): ClosingStoredDocument {
  return {
    type,
    status: 'not_requested',
    templateVersion: COURSE_CLOSING_TEMPLATE_VERSION,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 0,
  };
}

function documentForSnapshot(
  type: ClosingDocumentType,
  sourceNotificationId?: string
): ClosingStoredDocument {
  return {
    ...emptyDocument(type),
    status: 'pending',
    ...(sourceNotificationId ? { sourceNotificationId } : {}),
  };
}

function evidenceDate(data: Record<string, unknown>, keys: string[]): string | undefined {
  const raw = firstText(data, keys);
  if (!raw) return undefined;
  try {
    return normalizeArchiveDateOnly(raw, 'noticeDate');
  } catch {
    return undefined;
  }
}

function resolveTeacherName(
  teacherId: string,
  classData: Record<string, unknown>,
  users: BackfillSourceDoc[]
): string {
  const classTeacherName = firstText(classData, ['teacherName']);
  if (classTeacherName) return classTeacherName;
  const user = users.find((entry) => entry.id === teacherId);
  return user ? firstText(user.data, ['displayName', 'name']) || teacherId : teacherId;
}

function createBaseRecord(input: {
  classDoc: BackfillSourceDoc;
  studentDoc: BackfillSourceDoc;
  courseId: string;
  generatedAt: string;
  users: BackfillSourceDoc[];
}): CourseClosingRecord {
  const classData = input.classDoc.data;
  const studentData = input.studentDoc.data;
  const className = firstText(classData, ['name', 'className']);
  const studentName = firstText(studentData, ['name', 'studentName']);
  const studentCode = firstText(studentData, ['code', 'studentCode', 'studentId']);
  const courseStartDate = normalizeArchiveDateOnly(
    classData.startDate || classData.courseStartDate,
    'courseStartDate'
  );
  const courseEndDate = normalizeArchiveDateOnly(
    classData.endDate || classData.courseEndDate,
    'courseEndDate'
  );
  const teacherId = firstText(classData, ['teacherId']) || firstText(studentData, ['teacherId']);

  return {
    id: courseClosingRecordId(input.courseId, input.studentDoc.id),
    recordVersion: COURSE_CLOSING_RECORD_VERSION,
    closingMonth: closingMonthFromCourseEnd(courseEndDate),
    courseId: input.courseId,
    classId: input.classDoc.id,
    className,
    classNameNormalized: normalizeSearchText(className),
    courseStartDate,
    courseEndDate,
    studentId: input.studentDoc.id,
    studentName,
    studentNameNormalized: normalizeSearchText(studentName),
    studentCode,
    teacherId,
    teacherName: resolveTeacherName(teacherId, classData, input.users),
    evaluationDocument: emptyDocument('evaluation'),
    tuitionDocument: emptyDocument('tuition'),
    backfill: {
      version: 1,
      backfilledAt: input.generatedAt,
    },
    createdAt: input.generatedAt,
    updatedAt: input.generatedAt,
  };
}

function buildEvaluation(input: {
  courseId: string;
  classData: Record<string, unknown>;
  studentId: string;
  evaluations: BackfillSourceDoc[];
  notifications: BackfillSourceDoc[];
}) {
  const candidates = input.evaluations.filter(
    (entry) => text(entry.data.studentId) === input.studentId
  );
  const finalData = selectFinalEvaluation(candidates.map((entry) => entry.data));
  if (!finalData) return undefined;
  const finalDoc = candidates.find((entry) => entry.data === finalData);
  if (!finalDoc) return undefined;
  const scores = finalDoc.data.scores as Record<string, unknown> | undefined;
  const requiredScores = ['attendance', 'effort', 'pronunciation', 'homework', 'behavior'];
  if (
    !scores ||
    requiredScores.some((key) => scores[key] === undefined) ||
    finalDoc.data.date === undefined ||
    (finalDoc.data.finalScore === undefined && finalDoc.data.totalScore === undefined) ||
    finalDoc.data.totalScore === undefined
  ) {
    throw new Error('Final evaluation evidence is incomplete');
  }
  const midtermData = selectMidtermEvaluation(candidates.map((entry) => entry.data));
  const midtermDoc = midtermData
    ? candidates.find((entry) => entry.data === midtermData)
    : undefined;
  const evaluationVersion =
    finalDoc.updateTime ||
    firstText(finalDoc.data, ['updatedAt', 'createdAt', 'date']) ||
    finalDoc.id;
  const notification = input.notifications.find(
    (entry) =>
      text(entry.data.studentId) === input.studentId &&
      text(entry.data.status) === 'sent' &&
      ['evaluation_notice', 'evaluation'].includes(text(entry.data.type))
  );

  return {
    snapshot: buildEvaluationArchiveSnapshot({
      finalEvaluation: { ...finalDoc.data, id: finalDoc.id },
      evaluationVersion,
      ...(midtermDoc
        ? {
            midtermEvaluation: {
              evaluationId: midtermDoc.id,
              evaluationVersion:
                midtermDoc.updateTime ||
                firstText(midtermDoc.data, ['updatedAt', 'createdAt', 'date']) ||
                midtermDoc.id,
              data: midtermDoc.data,
            },
          }
        : {}),
    }),
    sourceNotificationId: notification?.id,
  };
}

function buildTuition(input: {
  courseId: string;
  classData: Record<string, unknown>;
  studentId: string;
  evaluations: BackfillSourceDoc[];
  notifications: BackfillSourceDoc[];
  ledgers: BackfillSourceDoc[];
  courseStartDate: string;
  courseEndDate: string;
  classId: string;
}) {
  const sentNotifications = input.notifications.filter(
    (entry) =>
      text(entry.data.studentId) === input.studentId &&
      text(entry.data.status) === 'sent' &&
      TUITION_NOTIFICATION_TYPES.has(text(entry.data.type))
  );
  const notificationFingerprint = (entry: BackfillSourceDoc) =>
    JSON.stringify({
      ledgerId: firstText(entry.data, ['ledgerId']),
      amount: firstFinite(entry.data, ['amount', 'tuitionAmount', 'schoolFee']),
      paymentDueDate: firstText(entry.data, ['paymentDueDate', 'tuitionDueDate', 'dueDate']),
      courseEndDate: firstText(entry.data, ['courseEndDate', 'termEnd']),
      nextCourseStartDate: firstText(entry.data, ['nextCourseStartDate']),
      nextCourseEndDate: firstText(entry.data, ['nextCourseEndDate']),
    });
  if (new Set(sentNotifications.map(notificationFingerprint)).size > 1) {
    return { invalid: true as const };
  }
  const notification = [...sentNotifications].sort(
    (left, right) =>
      firstText(right.data, ['createdAt', 'noticeDate']).localeCompare(
        firstText(left.data, ['createdAt', 'noticeDate'])
      ) || right.id.localeCompare(left.id)
  )[0];
  const referencedLedgerId = notification ? firstText(notification.data, ['ledgerId']) : '';
  const ledgerMatchesIdentity = (entry: BackfillSourceDoc) => {
    if (text(entry.data.studentId) !== input.studentId) return false;
    if (text(entry.data.classId) !== input.classId) return false;
    const sourceCourseId = text(entry.data.courseId);
    if (sourceCourseId) return sourceCourseId === input.courseId;
    const termStart = dateOrEmpty(entry.data.termStart, 'termStart');
    const termEnd = dateOrEmpty(entry.data.termEnd, 'termEnd');
    return termStart === input.courseStartDate && termEnd === input.courseEndDate;
  };
  const referencedLedger = referencedLedgerId
    ? input.ledgers.find((entry) => entry.id === referencedLedgerId)
    : undefined;
  if (referencedLedgerId && !referencedLedger) {
    return { invalid: true as const };
  }
  if (referencedLedger && !ledgerMatchesIdentity(referencedLedger)) {
    return { invalid: true as const };
  }
  const matchingLedgers = input.ledgers.filter(ledgerMatchesIdentity);
  if (matchingLedgers.length > 1) {
    return { invalid: true as const };
  }
  const ledger = referencedLedger || matchingLedgers[0];
  const ledgerHasSentEvidence = Boolean(
    Number(ledger?.data.tuitionNoticeCount || 0) > 0 || ledger?.data.tuitionNoticeLastSentAt
  );
  if (!notification && ledger && !ledgerHasSentEvidence) {
    return undefined;
  }
  if (!notification && !ledger) return undefined;

  const notificationAmount = notification
    ? firstFinite(notification.data, ['amount', 'tuitionAmount', 'schoolFee'])
    : undefined;
  const ledgerAmount = ledger
    ? firstFinite(ledger.data, ['tuitionNoticeLastAmount', 'amount', 'tuitionAmount'])
    : undefined;
  const notificationDueDate = notification
    ? firstText(notification.data, ['paymentDueDate', 'tuitionDueDate', 'dueDate'])
    : '';
  const ledgerDueDate = ledger
    ? firstText(ledger.data, [
        'tuitionNoticeLastDueDate',
        'paymentDueDate',
        'tuitionDueDate',
        'dueDate',
      ])
    : '';
  const notificationNoticeDate = notification
    ? evidenceDate(notification.data, ['noticeDate', 'createdAt'])
    : undefined;
  const ledgerNoticeDate = ledger
    ? evidenceDate(ledger.data, ['noticeDate', 'tuitionNoticeLastSentAt'])
    : undefined;
  const notificationNextStart = notification
    ? firstText(notification.data, ['nextCourseStartDate'])
    : '';
  const notificationNextEnd = notification
    ? firstText(notification.data, ['nextCourseEndDate'])
    : '';
  const ledgerNextStart = ledger ? firstText(ledger.data, ['nextCourseStartDate']) : '';
  const ledgerNextEnd = ledger ? firstText(ledger.data, ['nextCourseEndDate']) : '';
  const normalizedEvidenceDate = (value: string) =>
    value ? dateOrEmpty(value, 'evidenceDate') : '';
  if (
    (notificationAmount !== undefined &&
      ledgerAmount !== undefined &&
      notificationAmount !== ledgerAmount) ||
    (notificationDueDate &&
      ledgerDueDate &&
      normalizedEvidenceDate(notificationDueDate) !== normalizedEvidenceDate(ledgerDueDate)) ||
    (notificationNoticeDate && ledgerNoticeDate && notificationNoticeDate !== ledgerNoticeDate) ||
    (notificationNextStart &&
      ledgerNextStart &&
      normalizedEvidenceDate(notificationNextStart) !== normalizedEvidenceDate(ledgerNextStart)) ||
    (notificationNextEnd &&
      ledgerNextEnd &&
      normalizedEvidenceDate(notificationNextEnd) !== normalizedEvidenceDate(ledgerNextEnd))
  ) {
    return { invalid: true as const };
  }

  const amount = ledgerAmount ?? notificationAmount;
  const paymentDueDate = ledgerDueDate || notificationDueDate;
  const noticeDate = notificationNoticeDate || ledgerNoticeDate;
  const nextCourseStartDate = notificationNextStart || ledgerNextStart;
  const nextCourseEndDate = notificationNextEnd || ledgerNextEnd;
  if (
    amount === undefined ||
    amount < 0 ||
    !paymentDueDate ||
    !noticeDate ||
    !nextCourseStartDate ||
    !nextCourseEndDate
  ) {
    return { invalid: true as const };
  }

  const finalEvaluation = selectFinalEvaluation(
    input.evaluations
      .filter((entry) => text(entry.data.studentId) === input.studentId)
      .map((entry) => entry.data)
  );
  const candidateFinalExamScore = finalEvaluation
    ? firstFinite(finalEvaluation, ['finalScore', 'totalScore'])
    : undefined;
  const finalExamScore =
    candidateFinalExamScore !== undefined &&
    candidateFinalExamScore >= 0 &&
    candidateFinalExamScore <= 100
      ? candidateFinalExamScore
      : undefined;
  const normalizedFinalExamDate = finalEvaluation
    ? dateOrEmpty(finalEvaluation.date, 'finalExamDate')
    : '';
  const finalExamDate = normalizedFinalExamDate || undefined;

  return {
    invalid: false as const,
    snapshot: buildTuitionArchiveSnapshot({
      noticeDate,
      tuitionAmount: amount,
      paymentDueDate,
      courseStartDate: input.courseStartDate,
      courseEndDate: input.courseEndDate,
      ...(finalExamDate ? { finalExamDate } : {}),
      ...(finalExamScore !== undefined ? { finalExamScore } : {}),
      classData: input.classData,
      schedule: {
        previousEndDate: input.courseEndDate,
        startDate: nextCourseStartDate,
        endDate: nextCourseEndDate,
        dueDate: paymentDueDate,
      },
      ...(ledger ? { ledgerId: ledger.id } : {}),
    }),
    sourceNotificationId: notification?.id,
  };
}

function canonicalJson(value: unknown): string {
  const canonicalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(canonicalize);
    if (!current || typeof current !== 'object') return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  };
  return JSON.stringify(canonicalize(value));
}

function stableRecord(record: CourseClosingRecord): string {
  const { updatedAt: _updatedAt, ...rest } = record;
  return canonicalJson(rest);
}

export function mergeBackfillCandidate(
  existing: CourseClosingRecord | undefined,
  candidate: CourseClosingRecord
): {
  decision: Extract<BackfillDecisionKind, 'create' | 'merge' | 'unchanged' | 'ambiguous'>;
  record?: CourseClosingRecord;
  reasons: BackfillReasonCode[];
} {
  if (!existing) {
    return { decision: 'create', record: candidate, reasons: ['PLANNED_CREATE'] };
  }
  if (
    existing.id !== candidate.id ||
    existing.courseId !== candidate.courseId ||
    existing.classId !== candidate.classId ||
    existing.studentId !== candidate.studentId
  ) {
    return {
      decision: 'ambiguous',
      reasons: ['EXISTING_SNAPSHOT_CONFLICT'],
    };
  }
  if (
    (existing.evaluationSnapshot &&
      candidate.evaluationSnapshot &&
      canonicalJson(existing.evaluationSnapshot) !== canonicalJson(candidate.evaluationSnapshot)) ||
    (existing.tuitionSnapshot &&
      candidate.tuitionSnapshot &&
      canonicalJson(existing.tuitionSnapshot) !== canonicalJson(candidate.tuitionSnapshot))
  ) {
    return {
      decision: 'ambiguous',
      reasons: ['EXISTING_SNAPSHOT_CONFLICT'],
    };
  }

  const merged: CourseClosingRecord = {
    ...candidate,
    ...existing,
    evaluationSnapshot: existing.evaluationSnapshot || candidate.evaluationSnapshot,
    tuitionSnapshot: existing.tuitionSnapshot || candidate.tuitionSnapshot,
    evaluationDocument:
      existing.evaluationDocument?.status === 'ready'
        ? existing.evaluationDocument
        : candidate.evaluationSnapshot && !existing.evaluationSnapshot
          ? candidate.evaluationDocument
          : existing.evaluationDocument || candidate.evaluationDocument,
    tuitionDocument:
      existing.tuitionDocument?.status === 'ready'
        ? existing.tuitionDocument
        : candidate.tuitionSnapshot && !existing.tuitionSnapshot
          ? candidate.tuitionDocument
          : existing.tuitionDocument || candidate.tuitionDocument,
    createdAt: existing.createdAt,
    updatedAt: candidate.updatedAt,
  };
  if (!merged.evaluationSnapshot) delete merged.evaluationSnapshot;
  if (!merged.tuitionSnapshot) delete merged.tuitionSnapshot;

  if (stableRecord(existing) === stableRecord(merged)) {
    return { decision: 'unchanged', record: existing, reasons: ['NO_CHANGE'] };
  }
  return { decision: 'merge', record: merged, reasons: ['PLANNED_MERGE'] };
}

function emptySummary(): BackfillRunPlan['summary'] {
  return { create: 0, merge: 0, unchanged: 0, ambiguous: 0, skipped: 0 };
}

interface CourseDescriptor {
  courseId: string;
  termId?: string;
  startDate: string;
  endDate: string;
  current: boolean;
}

function dateOrEmpty(value: unknown, fieldName: string): string {
  try {
    return normalizeArchiveDateOnly(value, fieldName);
  } catch {
    return '';
  }
}

function resolveCourseDescriptors(input: {
  classDoc: BackfillSourceDoc;
  classEvaluations: BackfillSourceDoc[];
  classNotifications: BackfillSourceDoc[];
  classLedgers: BackfillSourceDoc[];
}): {
  descriptors: CourseDescriptor[];
  unresolvedCourseIds: string[];
} {
  const classData = input.classDoc.data;
  const currentCourseId = firstText(classData, ['currentCourseId', 'courseId']);
  const currentStart = dateOrEmpty(
    classData.startDate || classData.courseStartDate,
    'courseStartDate'
  );
  const currentEnd = dateOrEmpty(classData.endDate || classData.courseEndDate, 'courseEndDate');
  const descriptors = new Map<string, CourseDescriptor>();
  const unresolvedCourseIds: string[] = [];
  const terms = Array.isArray(classData.terms)
    ? classData.terms.filter(
        (term): term is Record<string, unknown> => Boolean(term) && typeof term === 'object'
      )
    : [];

  for (const term of terms) {
    const termId = text(term.id || term.termId);
    const courseId = text(term.courseId) || termId;
    const startDate = dateOrEmpty(term.startDate || term.termStart, 'courseStartDate');
    const endDate = dateOrEmpty(term.endDate || term.termEnd, 'courseEndDate');
    if (courseId && startDate && endDate) {
      descriptors.set(courseId, {
        courseId,
        ...(termId ? { termId } : {}),
        startDate,
        endDate,
        current: false,
      });
    } else if (startDate && endDate) {
      unresolvedCourseIds.push(`term@${startDate}|${endDate}`);
    }
  }
  if (currentCourseId && currentStart && currentEnd) {
    descriptors.set(currentCourseId, {
      courseId: currentCourseId,
      startDate: currentStart,
      endDate: currentEnd,
      current: true,
    });
  }

  const sourceDocs = [
    ...input.classEvaluations,
    ...input.classNotifications,
    ...input.classLedgers,
  ];
  const sourceCourseIds = new Set(
    sourceDocs.map((entry) => text(entry.data.courseId)).filter(Boolean)
  );

  for (const sourceCourseId of sourceCourseIds) {
    if (descriptors.has(sourceCourseId)) continue;
    const matchingSources = sourceDocs.filter(
      (entry) => text(entry.data.courseId) === sourceCourseId
    );
    const provesCurrentDates =
      Boolean(currentStart && currentEnd && matchingSources.length > 0) &&
      matchingSources.every(
        (source) =>
          dateOrEmpty(source.data.termStart, 'termStart') === currentStart &&
          dateOrEmpty(source.data.termEnd, 'termEnd') === currentEnd
      );
    if (provesCurrentDates) {
      if (currentCourseId && currentCourseId !== sourceCourseId) {
        descriptors.delete(currentCourseId);
      }
      descriptors.set(sourceCourseId, {
        courseId: sourceCourseId,
        startDate: currentStart,
        endDate: currentEnd,
        current: true,
      });
      continue;
    }
    const linkedDescriptor = [...descriptors.values()].find((descriptor) =>
      matchingSources.some((source) => {
        const sourceTermId = text(source.data.termId);
        if (sourceTermId && descriptor.termId && sourceTermId === descriptor.termId) return true;
        const termStart = dateOrEmpty(source.data.termStart, 'termStart');
        const termEnd = dateOrEmpty(source.data.termEnd, 'termEnd');
        if (
          termStart &&
          termEnd &&
          termStart === descriptor.startDate &&
          termEnd === descriptor.endDate
        ) {
          return true;
        }
        return false;
      })
    );
    if (linkedDescriptor) continue;

    const datePairs = new Map<string, { startDate: string; endDate: string }>();
    for (const source of matchingSources) {
      const startDate = dateOrEmpty(
        source.data.termStart || source.data.courseStartDate,
        'courseStartDate'
      );
      const endDate = dateOrEmpty(source.data.termEnd, 'courseEndDate');
      if (startDate && endDate) {
        datePairs.set(`${startDate}|${endDate}`, { startDate, endDate });
      }
    }
    if (datePairs.size !== 1) {
      unresolvedCourseIds.push(sourceCourseId);
      continue;
    }
    const [{ startDate, endDate }] = [...datePairs.values()];
    if (startDate && endDate) {
      const isCurrent = startDate === currentStart && endDate === currentEnd;
      if (isCurrent && currentCourseId && currentCourseId !== sourceCourseId) {
        descriptors.delete(currentCourseId);
      }
      descriptors.set(sourceCourseId, {
        courseId: sourceCourseId,
        startDate,
        endDate,
        current: isCurrent,
      });
    }
  }
  return { descriptors: [...descriptors.values()], unresolvedCourseIds };
}

function matchingCourseDescriptors(
  source: BackfillSourceDoc,
  descriptors: CourseDescriptor[],
  classData: Record<string, unknown>
): CourseDescriptor[] {
  const sourceCourseId = text(source.data.courseId);
  const sourceTermId = text(source.data.termId);
  const courseMatches = sourceCourseId
    ? descriptors.filter((descriptor) => descriptor.courseId === sourceCourseId)
    : undefined;
  const termMatches = sourceTermId
    ? descriptors.filter((descriptor) =>
        descriptor.current
          ? sourceTermId === 'current'
          : Boolean(descriptor.termId && sourceTermId === descriptor.termId)
      )
    : undefined;
  if (courseMatches && termMatches) {
    const termCourseIds = new Set(termMatches.map((descriptor) => descriptor.courseId));
    return courseMatches.filter((descriptor) => termCourseIds.has(descriptor.courseId));
  }
  if (courseMatches) return courseMatches;
  if (termMatches) return termMatches;

  const termStart = dateOrEmpty(source.data.termStart, 'termStart');
  const termEnd = dateOrEmpty(source.data.termEnd, 'termEnd');
  if (termStart || termEnd) {
    return descriptors.filter(
      (descriptor) => termStart === descriptor.startDate && termEnd === descriptor.endDate
    );
  }
  const courseEndDate = dateOrEmpty(source.data.courseEndDate, 'courseEndDate');
  if (courseEndDate) {
    return descriptors.filter((descriptor) => courseEndDate === descriptor.endDate);
  }
  return descriptors.filter(
    (descriptor) => descriptor.current && isCurrentAcademicCourseRecord(source.data, classData)
  );
}

function assignSourcesToDescriptors(input: {
  sources: BackfillSourceDoc[];
  descriptors: CourseDescriptor[];
  classData: Record<string, unknown>;
}): {
  byCourseId: Map<string, BackfillSourceDoc[]>;
  ambiguous: Array<{ source: BackfillSourceDoc; matches: CourseDescriptor[] }>;
} {
  const byCourseId = new Map<string, BackfillSourceDoc[]>();
  const ambiguous: Array<{ source: BackfillSourceDoc; matches: CourseDescriptor[] }> = [];
  for (const source of input.sources) {
    const matches = matchingCourseDescriptors(source, input.descriptors, input.classData);
    if (matches.length !== 1) {
      ambiguous.push({ source, matches });
      continue;
    }
    const descriptor = matches[0];
    const assigned = byCourseId.get(descriptor.courseId) || [];
    assigned.push(source);
    byCourseId.set(descriptor.courseId, assigned);
  }
  return { byCourseId, ambiguous };
}

export function planCourseClosingRecordBackfill(
  sources: BackfillSourceBundle,
  generatedAt: string
): BackfillRunPlan {
  const items: BackfillPlanItem[] = [];
  const existingById = new Map(sources.existingRecords.map((record) => [record.id, record]));
  const today = generatedAt.slice(0, 10);

  for (const classDoc of sources.classes) {
    const classData: Record<string, unknown> = {
      ...classDoc.data,
      id: classDoc.id,
    };
    const classStudents = sources.students.filter(
      (entry) => text(entry.data.classId) === classDoc.id
    );
    const classEvaluations = sources.evaluations.filter(
      (entry) => text(entry.data.classId) === classDoc.id
    );
    const classNotifications = sources.notifications.filter(
      (entry) =>
        text(entry.data.classId) === classDoc.id &&
        text(entry.data.status) === 'sent' &&
        (TUITION_NOTIFICATION_TYPES.has(text(entry.data.type)) ||
          ['evaluation_notice', 'evaluation'].includes(text(entry.data.type)))
    );
    const classLedgers = sources.ledgers.filter(
      (entry) => text(entry.data.classId) === classDoc.id
    );
    const classEnrollments = (sources.enrollments || []).filter(
      (entry) => text(entry.data.classId) === classDoc.id
    );
    const classExisting = sources.existingRecords.filter(
      (record) => record.classId === classDoc.id
    );
    const { descriptors, unresolvedCourseIds } = resolveCourseDescriptors({
      classDoc,
      classEvaluations,
      classNotifications,
      classLedgers,
    });
    const evaluationAssignments = assignSourcesToDescriptors({
      sources: classEvaluations,
      descriptors,
      classData,
    });
    const notificationAssignments = assignSourcesToDescriptors({
      sources: classNotifications,
      descriptors,
      classData,
    });
    const ledgerAssignments = assignSourcesToDescriptors({
      sources: classLedgers,
      descriptors,
      classData,
    });
    const enrollmentAssignments = assignSourcesToDescriptors({
      sources: classEnrollments.filter((entry) =>
        Boolean(text(entry.data.termStart) && text(entry.data.termEnd))
      ),
      descriptors,
      classData,
    });
    const ambiguousAssignments = [
      ...evaluationAssignments.ambiguous,
      ...notificationAssignments.ambiguous,
      ...ledgerAssignments.ambiguous,
      ...enrollmentAssignments.ambiguous,
    ];
    for (const { source, matches } of ambiguousAssignments) {
      const studentId = text(source.data.studentId);
      const studentDoc = sources.students.find((entry) => entry.id === studentId);
      items.push({
        recordId: '',
        classId: classDoc.id,
        className: firstText(classData, ['name', 'className']),
        courseId:
          matches.map((descriptor) => descriptor.courseId).join('|') ||
          firstText(source.data, ['courseId', 'termId']) ||
          'unresolved',
        studentId,
        studentCode: studentDoc
          ? firstText(studentDoc.data, ['code', 'studentCode', 'studentId'])
          : '',
        studentName: studentDoc ? firstText(studentDoc.data, ['name', 'studentName']) : '',
        decision: 'ambiguous',
        reasons: ['CONFLICTING_COURSE_ID'],
      });
    }

    if (unresolvedCourseIds.length > 0) {
      const unresolvedTermRanges = unresolvedCourseIds.flatMap((value) => {
        if (!value.startsWith('term@')) return [];
        const [startDate, endDate] = value.slice('term@'.length).split('|');
        return startDate && endDate ? [{ startDate, endDate }] : [];
      });
      const unresolvedStudentIds = new Set([
        ...classEnrollments
          .filter((entry) =>
            unresolvedTermRanges.some(
              (range) =>
                text(entry.data.termStart) === range.startDate &&
                text(entry.data.termEnd) === range.endDate
            )
          )
          .map((entry) => text(entry.data.studentId))
          .filter(Boolean),
      ]);
      if (unresolvedTermRanges.length > 0 && unresolvedStudentIds.size === 0) {
        unresolvedStudentIds.add('');
      }
      for (const studentId of unresolvedStudentIds) {
        const studentDoc = sources.students.find((entry) => entry.id === studentId);
        items.push({
          recordId: '',
          classId: classDoc.id,
          className: firstText(classData, ['name', 'className']),
          courseId: unresolvedCourseIds.join('|'),
          studentId,
          studentCode: studentDoc
            ? firstText(studentDoc.data, ['code', 'studentCode', 'studentId'])
            : '',
          studentName: studentDoc ? firstText(studentDoc.data, ['name', 'studentName']) : '',
          decision: 'ambiguous',
          reasons: ['CONFLICTING_COURSE_ID'],
        });
      }
      if (descriptors.length === 1 && !Array.isArray(classData.terms)) continue;
    }

    for (const descriptor of descriptors) {
      const descriptorClassData: Record<string, unknown> = {
        ...classData,
        startDate: descriptor.startDate,
        endDate: descriptor.endDate,
        currentCourseId: descriptor.courseId,
      };
      const descriptorEvaluations = evaluationAssignments.byCourseId.get(descriptor.courseId) || [];
      const descriptorNotifications =
        notificationAssignments.byCourseId.get(descriptor.courseId) || [];
      const descriptorLedgers = ledgerAssignments.byCourseId.get(descriptor.courseId) || [];
      const descriptorEnrollments = enrollmentAssignments.byCourseId.get(descriptor.courseId) || [];
      const descriptorExisting = classExisting.filter(
        (record) => record.courseId === descriptor.courseId
      );
      const studentIds = new Set([
        ...descriptorEvaluations.map((entry) => text(entry.data.studentId)),
        ...descriptorNotifications.map((entry) => text(entry.data.studentId)),
        ...descriptorLedgers.map((entry) => text(entry.data.studentId)),
        ...descriptorEnrollments.map((entry) => text(entry.data.studentId)),
        ...descriptorExisting.map((record) => record.studentId),
        ...(descriptor.current
          ? classStudents
              .filter((entry) => isRequiredAcademicEvaluationStudent(entry.data))
              .map((entry) => entry.id)
          : []),
      ]);
      studentIds.delete('');

      for (const studentId of studentIds) {
        const existing = existingById.get(courseClosingRecordId(descriptor.courseId, studentId));
        const storedStudent = sources.students.find((entry) => entry.id === studentId);
        const studentDoc =
          storedStudent ||
          (existing
            ? {
                id: existing.studentId,
                data: {
                  classId: existing.classId,
                  name: existing.studentName,
                  code: existing.studentCode,
                  teacherId: existing.teacherId,
                },
              }
            : undefined);
        const identity = {
          recordId: courseClosingRecordId(descriptor.courseId, studentId),
          classId: classDoc.id,
          className: firstText(classData, ['name', 'className']),
          courseId: descriptor.courseId,
          studentId,
          studentCode: studentDoc
            ? firstText(studentDoc.data, ['code', 'studentCode', 'studentId'])
            : '',
          studentName: studentDoc ? firstText(studentDoc.data, ['name', 'studentName']) : '',
        };
        if (!studentDoc) {
          items.push({
            ...identity,
            decision: 'ambiguous',
            reasons: ['IDENTITY_INCOMPLETE'],
          });
          continue;
        }
        if (descriptor.endDate > today) {
          items.push({
            ...identity,
            decision: 'skipped',
            reasons: ['NO_CLOSING_EVIDENCE'],
          });
          continue;
        }

        try {
          const descriptorClassDoc = {
            id: classDoc.id,
            data: descriptorClassData,
          };
          const candidate = createBaseRecord({
            classDoc: descriptorClassDoc,
            studentDoc,
            courseId: descriptor.courseId,
            generatedAt,
            users: sources.users,
          });
          const sourceReasons: BackfillReasonCode[] = [];
          let evaluation: ReturnType<typeof buildEvaluation>;
          try {
            evaluation = buildEvaluation({
              courseId: descriptor.courseId,
              classData: descriptorClassData,
              studentId,
              evaluations: descriptorEvaluations,
              notifications: descriptorNotifications,
            });
          } catch {
            sourceReasons.push('EVALUATION_SOURCE_INVALID');
          }
          if (evaluation) {
            candidate.evaluationSnapshot = evaluation.snapshot;
            candidate.evaluationDocument = documentForSnapshot(
              'evaluation',
              evaluation.sourceNotificationId
            );
          }
          let tuition: ReturnType<typeof buildTuition>;
          try {
            tuition = buildTuition({
              courseId: descriptor.courseId,
              classData: descriptorClassData,
              studentId,
              evaluations: descriptorEvaluations,
              notifications: descriptorNotifications,
              ledgers: descriptorLedgers,
              courseStartDate: candidate.courseStartDate,
              courseEndDate: candidate.courseEndDate,
              classId: classDoc.id,
            });
          } catch {
            tuition = { invalid: true };
          }
          if (tuition?.invalid) {
            sourceReasons.push('TUITION_SOURCE_INVALID');
          } else if (tuition) {
            candidate.tuitionSnapshot = tuition.snapshot;
            candidate.tuitionDocument = documentForSnapshot(
              'tuition',
              tuition.sourceNotificationId
            );
          }
          const merged = mergeBackfillCandidate(existing, candidate);
          items.push({
            ...identity,
            decision: merged.decision,
            reasons: [...merged.reasons, ...sourceReasons],
            ...(merged.record ? { candidate: merged.record } : {}),
            expectedExists: Boolean(existing),
            ...(sources.existingRecordVersions?.[candidate.id]
              ? { existingVersion: sources.existingRecordVersions[candidate.id] }
              : {}),
          });
        } catch {
          items.push({
            ...identity,
            decision: 'ambiguous',
            reasons: ['INVALID_COURSE_DATES'],
          });
        }
      }
    }
  }

  const summary = emptySummary();
  for (const item of items) summary[item.decision] += 1;
  return { generatedAt, items, summary };
}
