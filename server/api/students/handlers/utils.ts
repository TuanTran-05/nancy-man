export const STUDENT_FIELDS = [
  'name',
  'studentId',
  'dob',
  'contact',
  'classId',
  'faceImage',
  'faceImageStoragePath',
  'code',
  'gender',
  'grade',
];

export const VALID_STATUSES = ['active', 'on_leave', 'dropped', 'promoted'];

export function withStatus(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function isArchivedStudentRecord(student: Record<string, unknown>): boolean {
  return (
    student.studentLifecycle === 'archived' ||
    student.isRevoked === true ||
    Boolean(student.deletedAt)
  );
}
