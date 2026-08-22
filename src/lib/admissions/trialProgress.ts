import type { Attendance, Student } from '../../types';
import { deriveStudentLifecycle } from '../../../shared/studentLifecycle';

export function countTrialAttendance(student: Student, attendance: Attendance[]): number {
  if (deriveStudentLifecycle(student) !== 'trial') return 0;
  const classId = student.classId || student.trialClassId;
  const startMs = student.trialStartedAt ? new Date(student.trialStartedAt).getTime() : 0;
  const dates = new Set<string>();

  for (const record of attendance) {
    if (record.studentId !== student.id || record.classId !== classId) continue;
    if (record.status !== 'present' && record.status !== 'late') continue;
    if (startMs && new Date(`${record.date}T23:59:59`).getTime() < startMs) continue;
    dates.add(record.date);
  }

  return dates.size;
}

export function trialNeedsTeacherReview(student: Student, attendance: Attendance[]): boolean {
  if (deriveStudentLifecycle(student) !== 'trial') return false;
  if (student.trialReviewStatus === 'pending_teacher_review') return true;
  return countTrialAttendance(student, attendance) >= (student.trialRequiredSessions || 2);
}
