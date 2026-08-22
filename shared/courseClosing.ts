export const COURSE_CLOSING_EVALUATIONS_INCOMPLETE =
  'COURSE_CLOSING_EVALUATIONS_INCOMPLETE';
export const COURSE_CLOSING_NO_REQUIRED_STUDENTS = 'COURSE_CLOSING_NO_REQUIRED_STUDENTS';
export const COURSE_CLOSING_NOT_APPROVED = 'COURSE_CLOSING_NOT_APPROVED';
export const COURSE_CLOSING_STALE = 'COURSE_CLOSING_STALE';
export const COURSE_CLOSING_INCOMPLETE = 'COURSE_CLOSING_INCOMPLETE';
export const COURSE_CLOSING_STUDENT_EXEMPT = 'COURSE_CLOSING_STUDENT_EXEMPT';
export const EVALUATION_ALREADY_SENT_LOCKED = 'EVALUATION_ALREADY_SENT_LOCKED';

export type CourseClosingStatus =
  | 'no_required_students'
  | 'missing_evaluations'
  | 'ready_for_approval'
  | 'stale'
  | 'approved'
  | 'sending'
  | 'completed';

export type CourseClosingSendType = 'evaluation' | 'rank' | 'tuition';
export type CourseClosingApprovalStatus = 'approved' | 'invalidated';
export type CourseClosingInvalidationReason =
  | 'FINAL_EVALUATION_CHANGED'
  | 'REQUIRED_ROSTER_CHANGED'
  | 'COURSE_DATES_CHANGED'
  | 'APPROVAL_FINGERPRINT_MISMATCH';

export interface CourseClosingApproval {
  status: CourseClosingApprovalStatus;
  source: 'teacher' | 'admin' | 'migration';
  approvedAt: string;
  approvedBy: string;
  approvedByRole: 'teacher' | 'admin' | 'system';
  adminReason?: string;
  rosterFingerprint: string;
  evaluationFingerprint: string;
  invalidatedAt?: string;
  invalidatedBy?: string;
  invalidatedReason?: CourseClosingInvalidationReason;
}

export interface CourseClosingExemption {
  studentId: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface CourseClosingState {
  courseId: string;
  termStart: string;
  termEnd: string;
  approval?: CourseClosingApproval;
  exemptions?: CourseClosingExemption[];
}

export interface CourseClosingSendEvidence {
  studentId: string;
  evaluationSent: boolean;
  rankRequired: boolean;
  rankSent: boolean;
  tuitionSent: boolean;
  evaluationId?: string;
  evaluationVersion?: string;
}

export interface CourseClosingSnapshot {
  courseId: string;
  status: CourseClosingStatus;
  approvalValid: boolean;
  requiredStudentCount: number;
  finalEvaluationCount: number;
  evaluationSentCount: number;
  rankRequiredCount: number;
  rankSentCount: number;
  tuitionSentCount: number;
  exemptStudentCount: number;
  missingEvaluationStudentIds: string[];
  pendingEvaluationStudentIds: string[];
  pendingRankStudentIds: string[];
  pendingTuitionStudentIds: string[];
  lockedEvaluationIds: string[];
  exemptions: CourseClosingExemption[];
  staleReason?: CourseClosingInvalidationReason;
  approvedAt?: string;
  approvedBy?: string;
  approvedByRole?: string;
}

export interface DeriveCourseClosingSnapshotInput {
  courseId: string;
  requiredStudentIds: string[];
  completedEvaluationStudentIds: string[];
  approval?: CourseClosingApproval;
  fingerprintsMatch: boolean;
  evidence: CourseClosingSendEvidence[];
  exemptions: CourseClosingExemption[];
}

type AggregatedEvidence = Omit<CourseClosingSendEvidence, 'evaluationId' | 'evaluationVersion'> & {
  evaluationIds: Set<string>;
};

function sortedIds(values: Iterable<string>): string[] {
  return [...new Set(values)].filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function aggregateEvidence(
  evidence: CourseClosingSendEvidence[],
  requiredStudentIds: Set<string>,
): Map<string, AggregatedEvidence> {
  const byStudent = new Map<string, AggregatedEvidence>();
  for (const item of evidence) {
    if (!requiredStudentIds.has(item.studentId)) continue;
    const current = byStudent.get(item.studentId) ?? {
      studentId: item.studentId,
      evaluationSent: false,
      rankRequired: false,
      rankSent: false,
      tuitionSent: false,
      evaluationIds: new Set<string>(),
    };
    current.evaluationSent ||= item.evaluationSent;
    current.rankRequired ||= item.rankRequired;
    current.rankSent ||= item.rankSent;
    current.tuitionSent ||= item.tuitionSent;
    if (item.evaluationSent && item.evaluationId) current.evaluationIds.add(item.evaluationId);
    byStudent.set(item.studentId, current);
  }
  return byStudent;
}

export function deriveCourseClosingSnapshot(
  input: DeriveCourseClosingSnapshotInput,
): CourseClosingSnapshot {
  const requiredStudentIds = sortedIds(input.requiredStudentIds);
  const requiredStudentIdSet = new Set(requiredStudentIds);
  const completedEvaluationStudentIdSet = new Set(
    sortedIds(input.completedEvaluationStudentIds).filter((id) => requiredStudentIdSet.has(id)),
  );
  const missingEvaluationStudentIds = requiredStudentIds.filter(
    (studentId) => !completedEvaluationStudentIdSet.has(studentId),
  );
  const exemptStudentIds = new Set(
    input.exemptions
      .map(({ studentId }) => studentId)
      .filter((studentId) => requiredStudentIdSet.has(studentId)),
  );
  const evidenceByStudent = aggregateEvidence(input.evidence, requiredStudentIdSet);

  const pendingEvaluationStudentIds = requiredStudentIds.filter(
    (studentId) =>
      !exemptStudentIds.has(studentId) && !evidenceByStudent.get(studentId)?.evaluationSent,
  );
  const pendingRankStudentIds = requiredStudentIds.filter((studentId) => {
    const item = evidenceByStudent.get(studentId);
    return Boolean(
      !exemptStudentIds.has(studentId) && item?.rankRequired && !item.rankSent,
    );
  });
  const pendingTuitionStudentIds = requiredStudentIds.filter(
    (studentId) =>
      !exemptStudentIds.has(studentId) && !evidenceByStudent.get(studentId)?.tuitionSent,
  );

  const aggregatedEvidence = [...evidenceByStudent.values()];
  const evaluationSentCount = aggregatedEvidence.filter(({ evaluationSent }) => evaluationSent)
    .length;
  const rankRequiredCount = aggregatedEvidence.filter(({ rankRequired }) => rankRequired).length;
  const rankSentCount = aggregatedEvidence.filter(
    ({ rankRequired, rankSent }) => rankRequired && rankSent,
  ).length;
  const tuitionSentCount = aggregatedEvidence.filter(({ tuitionSent }) => tuitionSent).length;
  const lockedEvaluationIds = sortedIds(
    aggregatedEvidence.flatMap(({ evaluationIds }) => [...evaluationIds]),
  );

  const approvalValid =
    input.approval?.status === 'approved' && input.fingerprintsMatch === true;
  const hasApproval = Boolean(input.approval);
  const hasSentEvidence = aggregatedEvidence.some(
    ({ evaluationSent, rankSent, tuitionSent }) => evaluationSent || rankSent || tuitionSent,
  );
  const allSendsHandled =
    pendingEvaluationStudentIds.length === 0 &&
    pendingRankStudentIds.length === 0 &&
    pendingTuitionStudentIds.length === 0;

  let status: CourseClosingStatus;
  if (requiredStudentIds.length === 0) status = 'no_required_students';
  else if (missingEvaluationStudentIds.length > 0) status = 'missing_evaluations';
  else if (hasApproval && !approvalValid) status = 'stale';
  else if (!hasApproval) status = 'ready_for_approval';
  else if (allSendsHandled) status = 'completed';
  else if (hasSentEvidence) status = 'sending';
  else status = 'approved';

  return {
    courseId: input.courseId,
    status,
    approvalValid,
    requiredStudentCount: requiredStudentIds.length,
    finalEvaluationCount: completedEvaluationStudentIdSet.size,
    evaluationSentCount,
    rankRequiredCount,
    rankSentCount,
    tuitionSentCount,
    exemptStudentCount: exemptStudentIds.size,
    missingEvaluationStudentIds,
    pendingEvaluationStudentIds,
    pendingRankStudentIds,
    pendingTuitionStudentIds,
    lockedEvaluationIds,
    exemptions: input.exemptions.map((item) => ({ ...item })),
    ...(status === 'stale'
      ? {
          staleReason:
            input.approval?.invalidatedReason ?? 'APPROVAL_FINGERPRINT_MISMATCH',
        }
      : {}),
    ...(input.approval
      ? {
          approvedAt: input.approval.approvedAt,
          approvedBy: input.approval.approvedBy,
          approvedByRole: input.approval.approvedByRole,
        }
      : {}),
  };
}
