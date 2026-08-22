export type StudentProjectionView =
  | 'index'
  | 'identity'
  | 'academic'
  | 'directory'
  | 'finance'
  | 'session'
  | 'attendance';

const IDENTITY_FIELDS = ['id', 'name', 'studentId', 'code', 'classId'] as const;
const INDEX_FIELDS = [
  ...IDENTITY_FIELDS,
  'teacherId',
  'dob',
  'gender',
  'enrollmentStatus',
  'studentLifecycle',
  'admissionStatus',
  'leaveUntil',
  'isRevoked',
  'siblingGroupId',
] as const;
const ACADEMIC_FIELDS = [
  ...IDENTITY_FIELDS,
  'teacherId',
  'dob',
  'gender',
  'grade',
  'createdAt',
  'enrollmentStatus',
  'studentLifecycle',
  'admissionStatus',
  'trialReviewStatus',
  'trialSessionCount',
  'trialRequiredSessions',
  'trialStartedAt',
  'trialClassId',
  'trialTeacherId',
  'statusNote',
  'statusChangedAt',
  'enrollmentDate',
  'leaveUntil',
  'courseJoins',
  'leavePeriods',
  'isRevoked',
  'siblingGroupId',
] as const;
const DIRECTORY_FIELDS = [
  ...ACADEMIC_FIELDS,
  'contact',
  'faceImage',
  'faceImageStoragePath',
] as const;
const FINANCE_FIELDS = [
  ...IDENTITY_FIELDS,
  'dob',
  'contact',
  'enrollmentStatus',
  'studentLifecycle',
  'isRevoked',
  'siblingGroupId',
  'walletBalance',
  'walletHistoryStartedAt',
  'walletOpeningBalance',
] as const;
const SESSION_FIELDS = [
  ...IDENTITY_FIELDS,
  'teacherId',
  'faceImage',
  'faceImageStoragePath',
  'forcePasswordChange',
  'parentForcePasswordChange',
  'enrollmentStatus',
  'studentLifecycle',
  'statusChangedAt',
  'isRevoked',
] as const;
const ATTENDANCE_FIELDS = [...ACADEMIC_FIELDS, 'faceImage', 'faceImageStoragePath'] as const;

const VIEW_FIELDS: Record<StudentProjectionView, readonly string[]> = {
  index: INDEX_FIELDS,
  identity: IDENTITY_FIELDS,
  academic: ACADEMIC_FIELDS,
  directory: DIRECTORY_FIELDS,
  finance: FINANCE_FIELDS,
  session: SESSION_FIELDS,
  attendance: ATTENDANCE_FIELDS,
};

export const STUDENT_INDEX_QUERY_FIELDS = INDEX_FIELDS.filter((field) => field !== 'id');

export function isStudentProjectionView(value: string): value is StudentProjectionView {
  return Object.prototype.hasOwnProperty.call(VIEW_FIELDS, value);
}

export function projectStudent(
  data: Record<string, unknown>,
  view: StudentProjectionView
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of VIEW_FIELDS[view]) {
    if (data[field] === undefined) continue;
    if (field === 'enrollmentDate') {
      const enrollmentDate = normalizeDateTime(data[field]);
      if (enrollmentDate) projected[field] = enrollmentDate;
      continue;
    }
    projected[field] = data[field];
  }
  return projected;
}

function normalizeDateTime(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
