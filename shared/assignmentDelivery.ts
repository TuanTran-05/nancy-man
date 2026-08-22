export const ASSIGNMENT_TARGET_MODES = ['class', 'selected_students'] as const;
export const ASSIGNMENT_RESULT_RELEASE_POLICIES = ['after_submit', 'after_due', 'manual'] as const;

export type AssignmentTargetMode = (typeof ASSIGNMENT_TARGET_MODES)[number];
export type AssignmentResultReleasePolicy = (typeof ASSIGNMENT_RESULT_RELEASE_POLICIES)[number];

export interface AssignmentDeliveryPolicy {
  targetMode: AssignmentTargetMode;
  assignedStudentIds: string[];
  availableFrom: string;
  resultReleasePolicy: AssignmentResultReleasePolicy;
}

export const DEFAULT_ASSIGNMENT_DELIVERY_POLICY: AssignmentDeliveryPolicy = {
  targetMode: 'class',
  assignedStudentIds: [],
  availableFrom: '',
  resultReleasePolicy: 'after_submit',
};

function isTargetMode(value: unknown): value is AssignmentTargetMode {
  return ASSIGNMENT_TARGET_MODES.includes(value as AssignmentTargetMode);
}

function isReleasePolicy(value: unknown): value is AssignmentResultReleasePolicy {
  return ASSIGNMENT_RESULT_RELEASE_POLICIES.includes(value as AssignmentResultReleasePolicy);
}

export function normalizeAssignmentDeliveryPolicy(value: unknown): AssignmentDeliveryPolicy {
  if (!value || typeof value !== 'object') return DEFAULT_ASSIGNMENT_DELIVERY_POLICY;
  const input = value as Record<string, unknown>;
  const targetMode = isTargetMode(input.targetMode) ? input.targetMode : 'class';
  const assignedStudentIds = Array.isArray(input.assignedStudentIds)
    ? [...new Set(input.assignedStudentIds.map((item) => String(item).trim()).filter(Boolean))]
    : [];
  return {
    targetMode,
    assignedStudentIds: targetMode === 'selected_students' ? assignedStudentIds : [],
    availableFrom: typeof input.availableFrom === 'string' ? input.availableFrom.trim() : '',
    resultReleasePolicy: isReleasePolicy(input.resultReleasePolicy)
      ? input.resultReleasePolicy
      : 'after_submit',
  };
}

export function validateAssignmentDeliveryPolicy(policy: AssignmentDeliveryPolicy) {
  if (policy.targetMode === 'selected_students' && policy.assignedStudentIds.length === 0) {
    throw new Error('Selected-student assignments require at least one student');
  }
  if (policy.availableFrom && Number.isNaN(Date.parse(policy.availableFrom))) {
    throw new Error('availableFrom must be an ISO date-time');
  }
  return policy;
}

export function canStudentAccessAssignment(
  assignment: { classId?: string; deliveryPolicy?: unknown },
  student: { classId?: string; studentId?: string },
  now = new Date()
) {
  if (!assignment.classId || assignment.classId !== student.classId) return false;
  const policy = normalizeAssignmentDeliveryPolicy(assignment.deliveryPolicy);
  if (policy.availableFrom) {
    const availableMs = Date.parse(policy.availableFrom);
    if (Number.isFinite(availableMs) && now.getTime() < availableMs) return false;
  }
  if (policy.targetMode === 'selected_students') {
    return !!student.studentId && policy.assignedStudentIds.includes(student.studentId);
  }
  return true;
}

export function canStudentReviewAssignmentResults(input: {
  deliveryPolicy?: unknown;
  dueDate?: string;
  submissionCount?: number;
  attemptsAllowed?: number;
  now?: Date;
}) {
  const now = input.now || new Date();
  const dueMs = Date.parse(String(input.dueDate || ''));
  const dueDatePassed = Number.isFinite(dueMs) && now.getTime() >= dueMs;
  const submissionCount = Math.max(Number(input.submissionCount || 0), 0);
  const attemptsAllowed = Math.max(Number(input.attemptsAllowed || 1), 1);
  const hasExplicitPolicy = !!input.deliveryPolicy && typeof input.deliveryPolicy === 'object';

  if (!hasExplicitPolicy) {
    return dueDatePassed || submissionCount >= attemptsAllowed;
  }

  const policy = normalizeAssignmentDeliveryPolicy(input.deliveryPolicy);
  if (policy.resultReleasePolicy === 'manual') return false;
  if (policy.resultReleasePolicy === 'after_due') return dueDatePassed;
  return submissionCount > 0;
}
