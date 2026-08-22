export const ASSIGNMENT_PROCTORING_MODES = ['strict', 'normal'] as const;

export type AssignmentProctoringMode = (typeof ASSIGNMENT_PROCTORING_MODES)[number];

export const DEFAULT_ASSIGNMENT_PROCTORING_MODE: AssignmentProctoringMode = 'strict';

export function isAssignmentProctoringMode(value: unknown): value is AssignmentProctoringMode {
  return value === 'strict' || value === 'normal';
}

export function normalizeAssignmentProctoringMode(value: unknown): AssignmentProctoringMode {
  return isAssignmentProctoringMode(value) ? value : DEFAULT_ASSIGNMENT_PROCTORING_MODE;
}
