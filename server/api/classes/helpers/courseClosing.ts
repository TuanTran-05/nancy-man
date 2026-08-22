import { createHash } from 'node:crypto';
import type {
  DocumentSnapshot,
  DocumentStore,
  QueryDocumentSnapshot,
  Transaction,
} from '@/server/db/documentStore.js';
import {
  isCurrentAcademicCourseRecord,
  isRequiredAcademicEvaluationStudent,
  selectFinalEvaluation,
  type AcademicEvaluationLike,
} from '../../../../shared/academic.js';
import {
  COURSE_CLOSING_EVALUATIONS_INCOMPLETE,
  COURSE_CLOSING_INCOMPLETE,
  COURSE_CLOSING_NOT_APPROVED,
  COURSE_CLOSING_NO_REQUIRED_STUDENTS,
  COURSE_CLOSING_STALE,
  COURSE_CLOSING_STUDENT_EXEMPT,
  EVALUATION_ALREADY_SENT_LOCKED,
  deriveCourseClosingSnapshot,
  type CourseClosingApproval,
  type CourseClosingExemption,
  type CourseClosingInvalidationReason,
  type CourseClosingSendEvidence,
  type CourseClosingSnapshot,
  type CourseClosingState,
} from '../../../../shared/courseClosing.js';
import { isRankedEvaluation } from '../../../../shared/evaluationRank.js';
import { withStatus } from '../../lib/http/helpers.js';
import { loadCourseTermRosters } from '../../lib/student/courseTermRoster.js';

export type CourseClosingErrorCode =
  | typeof COURSE_CLOSING_EVALUATIONS_INCOMPLETE
  | typeof COURSE_CLOSING_NO_REQUIRED_STUDENTS
  | typeof COURSE_CLOSING_NOT_APPROVED
  | typeof COURSE_CLOSING_STALE
  | typeof COURSE_CLOSING_INCOMPLETE
  | typeof COURSE_CLOSING_STUDENT_EXEMPT
  | typeof EVALUATION_ALREADY_SENT_LOCKED;

export class CourseClosingError extends Error {
  constructor(
    public readonly statusCode: 409,
    public readonly errorCode: CourseClosingErrorCode,
    message: string,
    public readonly courseClosing?: CourseClosingSnapshot
  ) {
    super(message);
    this.name = 'CourseClosingError';
  }
}

export interface CourseClosingContext {
  classDoc: DocumentSnapshot;
  courseId: string;
  students: DocumentSnapshot[];
  evaluations: QueryDocumentSnapshot[];
  sentNotifications: QueryDocumentSnapshot[];
}

export interface CourseClosingFingerprints {
  rosterFingerprint: string;
  evaluationFingerprint: string;
}

export interface CourseClosingComputation {
  snapshot: CourseClosingSnapshot;
  fingerprints: CourseClosingFingerprints;
  requiredStudentIds: string[];
}

export interface CourseClosingSendContext {
  courseId: string;
  classData: Record<string, unknown>;
  studentData: Record<string, unknown>;
  finalEvaluationData: Record<string, unknown>;
  evaluationId: string;
  evaluationVersion: string;
  snapshot: CourseClosingSnapshot;
}

export interface CourseClosingClassApprovalContext {
  courseId: string;
  snapshot: CourseClosingSnapshot;
}

export class CourseClosingAlreadySentError extends Error {
  readonly alreadySent = true;

  constructor(
    public readonly type: 'evaluation' | 'rank' | 'tuition',
    public readonly context: CourseClosingSendContext
  ) {
    super(`Course closing ${type} notification is already sent`);
    this.name = 'CourseClosingAlreadySentError';
  }
}

const EVALUATION_NOTIFICATION_TYPES = new Set(['evaluation', 'evaluation_notice']);
const RANK_NOTIFICATION_TYPES = new Set(['rank_achievement']);
const TUITION_NOTIFICATION_TYPES = new Set(['tuition_notice', 'next_course_tuition']);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

const digest = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

export function createCourseClosingFingerprints(input: {
  courseId: string;
  startDate?: string;
  endDate?: string;
  requiredStudentIds: string[];
  finalEvaluations: Array<{
    studentId: string;
    evaluationId: string;
    evaluationVersion: string;
  }>;
}): CourseClosingFingerprints {
  const requiredStudentIds = [...new Set(input.requiredStudentIds)].sort((left, right) =>
    left.localeCompare(right)
  );
  const finalEvaluations = [...input.finalEvaluations].sort(
    (left, right) =>
      left.studentId.localeCompare(right.studentId) ||
      left.evaluationId.localeCompare(right.evaluationId) ||
      left.evaluationVersion.localeCompare(right.evaluationVersion)
  );
  return {
    rosterFingerprint: digest({
      courseId: input.courseId,
      startDate: String(input.startDate || ''),
      endDate: String(input.endDate || ''),
      requiredStudentIds,
    }),
    evaluationFingerprint: digest({
      courseId: input.courseId,
      finalEvaluations,
    }),
  };
}

export const evaluationVersion = (doc: QueryDocumentSnapshot): string =>
  typeof doc.updateTime?.toDate === 'function'
    ? doc.updateTime.toDate().toISOString()
    : String(doc.data()?.updatedAt || '1970-01-01T00:00:00.000Z');

type SelectedFinalEvaluation = {
  doc: QueryDocumentSnapshot;
  data: Record<string, unknown>;
  studentId: string;
  evaluationId: string;
  evaluationVersion: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function selectedFinalEvaluations(
  context: CourseClosingContext,
  requiredStudentIds: string[],
  classData: Record<string, unknown>
): SelectedFinalEvaluation[] {
  const requiredStudentIdSet = new Set(requiredStudentIds);
  const currentEvaluations = context.evaluations
    .map((doc) => ({ doc, data: (doc.data() || {}) as Record<string, unknown> }))
    .filter(({ data }) => {
      const studentId = String(data.studentId || '');
      return requiredStudentIdSet.has(studentId) && isCurrentAcademicCourseRecord(data, classData);
    });

  return requiredStudentIds.flatMap((studentId) => {
    type EvaluationCandidate = AcademicEvaluationLike & {
      __item: (typeof currentEvaluations)[number];
    };
    const candidates: EvaluationCandidate[] = currentEvaluations
      .filter(({ data }) => String(data.studentId || '') === studentId)
      .map((item) => ({ ...item.data, __item: item }));
    const selected = selectFinalEvaluation<EvaluationCandidate>(candidates);
    if (!selected) return [];
    const item = selected.__item;
    return [
      {
        ...item,
        studentId,
        evaluationId: item.doc.id,
        evaluationVersion: evaluationVersion(item.doc),
      },
    ];
  });
}

function matchesEvaluationEvidence(
  data: Record<string, unknown>,
  courseId: string,
  evaluation: SelectedFinalEvaluation,
  allowedTypes: Set<string>
): boolean {
  return (
    String(data.status || '') === 'sent' &&
    String(data.courseId || '') === courseId &&
    String(data.studentId || '') === evaluation.studentId &&
    allowedTypes.has(String(data.type || '')) &&
    String(data.evaluationId || '') === evaluation.evaluationId &&
    String(data.evaluationVersion || '') === evaluation.evaluationVersion
  );
}

export function courseClosingComputationFromContext(
  context: CourseClosingContext
): CourseClosingComputation {
  const classData = (context.classDoc.data() || {}) as Record<string, unknown>;
  const requiredStudentIds = context.students
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter(isRequiredRosterStudent)
    .map(({ id }) => id)
    .sort((left, right) => left.localeCompare(right));
  const selectedEvaluations = selectedFinalEvaluations(context, requiredStudentIds, classData);
  const selectedByStudent = new Map(
    selectedEvaluations.map((evaluation) => [evaluation.studentId, evaluation])
  );
  const notifications = context.sentNotifications
    .map((doc) => (doc.data() || {}) as Record<string, unknown>)
    .filter(
      (data) =>
        String(data.status || '') === 'sent' && String(data.courseId || '') === context.courseId
    );
  const evidence: CourseClosingSendEvidence[] = requiredStudentIds.map((studentId) => {
    const currentEvaluation = selectedByStudent.get(studentId);
    const tuitionSent = notifications.some(
      (data) =>
        String(data.studentId || '') === studentId &&
        TUITION_NOTIFICATION_TYPES.has(String(data.type || ''))
    );
    if (!currentEvaluation) {
      return {
        studentId,
        evaluationSent: false,
        rankRequired: false,
        rankSent: false,
        tuitionSent,
      };
    }
    const evaluationSent = notifications.some((data) =>
      matchesEvaluationEvidence(
        data,
        context.courseId,
        currentEvaluation,
        EVALUATION_NOTIFICATION_TYPES
      )
    );
    const rankRequired = isRankedEvaluation(currentEvaluation.data.rank);
    const rankSent =
      rankRequired &&
      notifications.some((data) =>
        matchesEvaluationEvidence(
          data,
          context.courseId,
          currentEvaluation,
          RANK_NOTIFICATION_TYPES
        )
      );
    return {
      studentId,
      evaluationSent,
      rankRequired,
      rankSent,
      tuitionSent,
      evaluationId: currentEvaluation.evaluationId,
      evaluationVersion: currentEvaluation.evaluationVersion,
    };
  });

  const fingerprints = createCourseClosingFingerprints({
    courseId: context.courseId,
    startDate: String(classData.startDate || ''),
    endDate: String(classData.endDate || ''),
    requiredStudentIds,
    finalEvaluations: selectedEvaluations.map(
      ({ studentId, evaluationId, evaluationVersion: version }) => ({
        studentId,
        evaluationId,
        evaluationVersion: version,
      })
    ),
  });
  const storedState = isRecord(classData.courseClosing)
    ? (classData.courseClosing as unknown as CourseClosingState)
    : undefined;
  const approval = storedState?.approval as CourseClosingApproval | undefined;
  const fingerprintsMatch = Boolean(
    approval &&
    storedState?.courseId === context.courseId &&
    storedState.termStart === String(classData.startDate || '') &&
    storedState.termEnd === String(classData.endDate || '') &&
    approval.rosterFingerprint === fingerprints.rosterFingerprint &&
    approval.evaluationFingerprint === fingerprints.evaluationFingerprint
  );
  const exemptions: CourseClosingExemption[] =
    storedState?.courseId === context.courseId && Array.isArray(storedState.exemptions)
      ? storedState.exemptions
      : [];

  const snapshot = deriveCourseClosingSnapshot({
    courseId: context.courseId,
    requiredStudentIds,
    completedEvaluationStudentIds: selectedEvaluations.map(({ studentId }) => studentId),
    approval,
    fingerprintsMatch,
    evidence,
    exemptions,
  });
  return { snapshot, fingerprints, requiredStudentIds };
}

export function snapshotFromCourseClosingContext(
  context: CourseClosingContext
): CourseClosingSnapshot {
  return courseClosingComputationFromContext(context).snapshot;
}

async function readTarget<T>(
  target: { get: () => Promise<T> },
  transaction?: Transaction
): Promise<T> {
  return transaction ? ((await transaction.get(target as never)) as T) : target.get();
}

async function loadCourseClosingComputation(
  db: DocumentStore,
  classId: string,
  options: {
    transaction?: Transaction;
    courseIdOverride?: string;
  } = {}
): Promise<{ context: CourseClosingContext; computation: CourseClosingComputation }> {
  const classRef = db.collection('classes').doc(classId);
  const classDoc = await readTarget(classRef, options.transaction);
  if (!classDoc.exists) throw withStatus('Class not found', 404);
  const classData = (classDoc.data() || {}) as Record<string, unknown>;
  const courseId = String(options.courseIdOverride ?? classData.currentCourseId ?? '');

  const evaluationsQuery = db.collection('evaluations').where('classId', '==', classId);
  const sentNotificationsQuery = db
    .collection('zalo_notifications')
    .where('courseId', '==', courseId)
    .where('status', '==', 'sent');
  const rosters = await loadCourseTermRosters(
    db,
    [{ classId, termStart: String(classData.startDate || '') || undefined }],
    { transaction: options.transaction }
  );
  const students = (rosters.get(classId) || []).map((member) => member.studentDoc);
  const evaluations = await readTarget(evaluationsQuery, options.transaction);
  const sentNotifications = await readTarget(sentNotificationsQuery, options.transaction);
  const context: CourseClosingContext = {
    classDoc,
    courseId,
    students,
    evaluations: evaluations.docs,
    sentNotifications: sentNotifications.docs,
  };
  return { context, computation: courseClosingComputationFromContext(context) };
}

export async function computeCourseClosingComputation(
  db: DocumentStore,
  classId: string,
  options: {
    transaction?: Transaction;
    courseIdOverride?: string;
  } = {}
): Promise<CourseClosingComputation> {
  return (await loadCourseClosingComputation(db, classId, options)).computation;
}

export async function computeCourseClosingSnapshot(
  db: DocumentStore,
  classId: string,
  options: {
    transaction?: Transaction;
    courseIdOverride?: string;
  } = {}
): Promise<CourseClosingSnapshot> {
  return (await computeCourseClosingComputation(db, classId, options)).snapshot;
}

export async function assertCourseClosingClassApproved(
  db: DocumentStore,
  classId: string
): Promise<CourseClosingClassApprovalContext> {
  const { context, computation } = await loadCourseClosingComputation(db, classId);
  const { snapshot, requiredStudentIds } = computation;
  const classData = (context.classDoc.data() || {}) as Record<string, unknown>;
  if (!context.courseId) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_NOT_APPROVED,
      'Course closing has no current course to approve',
      snapshot
    );
  }
  if (requiredStudentIds.length === 0) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_NO_REQUIRED_STUDENTS,
      'Course closing has no required students',
      snapshot
    );
  }
  if (snapshot.missingEvaluationStudentIds.length > 0) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_EVALUATIONS_INCOMPLETE,
      'Current final evaluations are incomplete',
      snapshot
    );
  }

  const storedState = isRecord(classData.courseClosing)
    ? (classData.courseClosing as unknown as CourseClosingState)
    : undefined;
  const approval = storedState?.courseId === context.courseId ? storedState.approval : undefined;
  if (!approval) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_NOT_APPROVED,
      'Course closing approval is required before sending',
      snapshot
    );
  }
  if (!snapshot.approvalValid) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_STALE,
      'Course closing approval is stale',
      snapshot
    );
  }

  return { courseId: context.courseId, snapshot };
}

export async function assertCourseClosingSendAllowed(
  db: DocumentStore,
  input: {
    classId: string;
    studentId: string;
    type: 'evaluation' | 'rank' | 'tuition';
    allowAlreadySent?: boolean;
  }
): Promise<CourseClosingSendContext> {
  const { context, computation } = await loadCourseClosingComputation(db, input.classId);
  const { snapshot, requiredStudentIds } = computation;
  const classData = (context.classDoc.data() || {}) as Record<string, unknown>;
  if (!context.courseId) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_NOT_APPROVED,
      'Course closing has no current course to approve',
      snapshot
    );
  }

  const studentDoc = context.students.find(
    (doc) => doc.id === input.studentId && String(doc.data()?.classId || '') === input.classId
  );
  if (!studentDoc) throw withStatus('Student not found in class', 404);
  if (!requiredStudentIds.includes(input.studentId)) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_STUDENT_EXEMPT,
      'Student is not in the current required roster',
      snapshot
    );
  }

  const finalEvaluation = selectedFinalEvaluations(context, [input.studentId], classData)[0];
  if (!finalEvaluation) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_EVALUATIONS_INCOMPLETE,
      'Current final evaluation is required before sending',
      snapshot
    );
  }

  const storedState = isRecord(classData.courseClosing)
    ? (classData.courseClosing as unknown as CourseClosingState)
    : undefined;
  const approval = storedState?.courseId === context.courseId ? storedState.approval : undefined;
  if (!approval) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_NOT_APPROVED,
      'Course closing approval is required before sending',
      snapshot
    );
  }
  if (!snapshot.approvalValid) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_STALE,
      'Course closing approval is stale',
      snapshot
    );
  }
  if (snapshot.exemptions.some(({ studentId }) => studentId === input.studentId)) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_STUDENT_EXEMPT,
      'Student is exempt from course closing notifications',
      snapshot
    );
  }

  const sendContext: CourseClosingSendContext = {
    courseId: context.courseId,
    classData: { id: context.classDoc.id, ...classData },
    studentData: { id: studentDoc.id, ...(studentDoc.data() || {}) },
    finalEvaluationData: finalEvaluation.data,
    evaluationId: finalEvaluation.evaluationId,
    evaluationVersion: finalEvaluation.evaluationVersion,
    snapshot,
  };

  const sentNotifications = context.sentNotifications.map(
    (doc) => (doc.data() || {}) as Record<string, unknown>
  );
  const matchingEvaluationEvidence = (allowedTypes: Set<string>) =>
    sentNotifications.some((data) =>
      matchesEvaluationEvidence(data, context.courseId, finalEvaluation, allowedTypes)
    );
  const alreadySent =
    input.type === 'evaluation'
      ? matchingEvaluationEvidence(EVALUATION_NOTIFICATION_TYPES)
      : input.type === 'rank'
        ? matchingEvaluationEvidence(RANK_NOTIFICATION_TYPES)
        : sentNotifications.some(
            (data) =>
              String(data.courseId || '') === context.courseId &&
              String(data.studentId || '') === input.studentId &&
              TUITION_NOTIFICATION_TYPES.has(String(data.type || ''))
          );
  if (alreadySent && !input.allowAlreadySent) {
    throw new CourseClosingAlreadySentError(input.type, sendContext);
  }

  if (input.type === 'rank' && !isRankedEvaluation(finalEvaluation.data.rank)) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_INCOMPLETE,
      'Current final evaluation has no eligible rank',
      snapshot
    );
  }
  if (input.type === 'tuition' && !matchingEvaluationEvidence(EVALUATION_NOTIFICATION_TYPES)) {
    throw new CourseClosingError(
      409,
      COURSE_CLOSING_INCOMPLETE,
      'Current evaluation notice must be sent before tuition',
      snapshot
    );
  }

  return sendContext;
}

export async function isCurrentFinalEvaluation(
  db: DocumentStore,
  evaluationData: Record<string, unknown>,
  transaction?: Transaction
): Promise<boolean> {
  if (String(evaluationData.evaluationType || '') !== 'final') return false;
  const classId = String(evaluationData.classId || '');
  if (!classId) return false;
  const classSnap = await readTarget(db.collection('classes').doc(classId), transaction);
  if (!classSnap.exists) return false;
  return isCurrentAcademicCourseRecord(
    evaluationData,
    (classSnap.data() || {}) as Record<string, unknown>
  );
}

export async function assertEvaluationNotLocked(
  db: DocumentStore,
  evaluation: QueryDocumentSnapshot,
  transaction?: Transaction
): Promise<void> {
  const evaluationData = (evaluation.data() || {}) as Record<string, unknown>;
  if (!(await isCurrentFinalEvaluation(db, evaluationData, transaction))) return;

  const classId = String(evaluationData.classId || '');
  const classSnap = await readTarget(db.collection('classes').doc(classId), transaction);
  if (!classSnap.exists) return;
  const courseId = String(classSnap.data()?.currentCourseId || '');
  if (!courseId) return;

  const notificationQuery = db
    .collection('zalo_notifications')
    .where('courseId', '==', courseId)
    .where('status', '==', 'sent');
  const sentNotifications = await readTarget(notificationQuery, transaction);
  const version = evaluationVersion(evaluation);
  const locked = sentNotifications.docs.some((doc) => {
    const data = (doc.data() || {}) as Record<string, unknown>;
    return (
      String(data.courseId || '') === courseId &&
      String(data.status || '') === 'sent' &&
      EVALUATION_NOTIFICATION_TYPES.has(String(data.type || '')) &&
      String(data.evaluationId || '') === evaluation.id &&
      String(data.evaluationVersion || '') === version
    );
  });
  if (locked) {
    throw new CourseClosingError(
      409,
      EVALUATION_ALREADY_SENT_LOCKED,
      'This final evaluation version has already been sent and cannot be changed'
    );
  }
}

export async function invalidateCourseClosingApproval(
  db: DocumentStore,
  classId: string,
  actorId: string,
  reason: CourseClosingInvalidationReason,
  transaction?: Transaction
): Promise<boolean> {
  if (!classId) return false;
  const classRef = db.collection('classes').doc(classId);
  const classSnap = await readTarget(classRef, transaction);
  if (!classSnap.exists) return false;
  const classData = (classSnap.data() || {}) as Record<string, unknown>;
  const currentCourseId = String(classData.currentCourseId || '');
  const state = isRecord(classData.courseClosing)
    ? (classData.courseClosing as unknown as CourseClosingState)
    : undefined;
  if (
    !currentCourseId ||
    state?.courseId !== currentCourseId ||
    state.approval?.status !== 'approved'
  ) {
    return false;
  }

  const update = {
    'courseClosing.approval.status': 'invalidated',
    'courseClosing.approval.invalidatedAt': new Date().toISOString(),
    'courseClosing.approval.invalidatedBy': actorId,
    'courseClosing.approval.invalidatedReason': reason,
  };
  if (transaction) transaction.update(classRef, update);
  else await classRef.update(update);
  return true;
}

function rosterStudentView(value: Record<string, unknown> | null | undefined) {
  if (!value) return undefined;
  return {
    enrollmentStatus: value.enrollmentStatus ?? value.status,
    studentLifecycle: value.studentLifecycle ?? (value.archived === true ? 'archived' : undefined),
  };
}

function isRequiredRosterStudent(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) return false;
  const lifecycle = String(value.studentLifecycle || '');
  if (lifecycle && lifecycle !== 'enrolled') return false;
  const student = rosterStudentView(value);
  return Boolean(student && isRequiredAcademicEvaluationStudent(student));
}

export function changedRequiredRosterClassIds(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): string[] {
  const beforeClassId = String(before?.classId || '');
  const afterClassId = String(after?.classId || '');
  const beforeRequired = isRequiredRosterStudent(before);
  const afterRequired = isRequiredRosterStudent(after);
  const changedClass = beforeClassId !== afterClassId;
  const affected: string[] = [];

  if (beforeRequired && (!afterRequired || changedClass) && beforeClassId) {
    affected.push(beforeClassId);
  }
  if (afterRequired && (!beforeRequired || changedClass) && afterClassId) {
    affected.push(afterClassId);
  }
  return [...new Set(affected)];
}

export async function invalidateCourseClosingApprovals(
  db: DocumentStore,
  classIds: Iterable<string | null | undefined>,
  actorId: string,
  reason: Extract<
    CourseClosingInvalidationReason,
    'REQUIRED_ROSTER_CHANGED' | 'COURSE_DATES_CHANGED'
  >
): Promise<string[]> {
  const uniqueClassIds = [...new Set([...classIds].map((id) => String(id || '')).filter(Boolean))];
  const invalidated: string[] = [];
  for (const classId of uniqueClassIds) {
    if (await invalidateCourseClosingApproval(db, classId, actorId, reason)) {
      invalidated.push(classId);
    }
  }
  return invalidated;
}
