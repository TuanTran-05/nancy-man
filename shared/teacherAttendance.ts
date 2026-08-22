export const TEACHER_ATTENDANCE_PAYROLL_START_DATE = '2026-06-01';

export type TeacherAttendanceStatus = 'present' | 'absent';
export type TeacherAttendanceDisplayStatus = 'pending' | TeacherAttendanceStatus;
export type SessionStatusForTeacherAttendance = 'taught' | 'cancelled' | 'makeup';

export function getEffectiveTeacherIdForSession(input: {
  acceptedSubstituteTeacherId?: string | null;
  sessionTeacherId?: string | null;
  classTeacherId?: string | null;
}): string {
  const acceptedSubstituteTeacherId = String(input.acceptedSubstituteTeacherId || '').trim();
  if (acceptedSubstituteTeacherId) return acceptedSubstituteTeacherId;

  const sessionTeacherId = String(input.sessionTeacherId || '').trim();
  if (sessionTeacherId) return sessionTeacherId;

  return String(input.classTeacherId || '').trim();
}

export function getTeacherAttendanceDisplayStatus(
  status: TeacherAttendanceStatus | undefined | null
): TeacherAttendanceDisplayStatus {
  return status === 'present' || status === 'absent' ? status : 'pending';
}

export function isTeacherAttendancePayrollRequired(date: string): boolean {
  return date >= TEACHER_ATTENDANCE_PAYROLL_START_DATE;
}

export function shouldCountSessionForPayroll(input: {
  date: string;
  sessionStatus?: SessionStatusForTeacherAttendance;
  teacherAttendanceStatus?: TeacherAttendanceStatus;
  isScheduledDate: boolean;
}): boolean {
  if (input.sessionStatus === 'cancelled') return false;
  if (isTeacherAttendancePayrollRequired(input.date)) {
    return input.teacherAttendanceStatus === 'present';
  }
  if (input.sessionStatus === 'taught' || input.sessionStatus === 'makeup') return true;
  return input.isScheduledDate;
}
