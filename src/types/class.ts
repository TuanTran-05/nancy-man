import type { CourseClosingState } from '../../shared/courseClosing';

export interface ClassTerm {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  holidays?: string[];
  weeklySessions?: WeeklyClassSession[];
  daysOfWeek?: number[];
  courseId?: string;
  tuitionFee?: number;
  resetOperationId?: string;
  courseClosing?: CourseClosingState;
}

export type ClassStatus = 'active' | 'paused' | 'archived';

export interface WeeklyClassSession {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
}

export interface Class {
  id: string;
  currentCourseId?: string;
  courseClosing?: CourseClosingState;
  /** Derived by projectedClassDoc when the closing approval is still in force. */
  courseClosingApproved?: boolean;
  weeklySessions?: WeeklyClassSession[];
  name: string;
  schedule: string;
  daysOfWeek: number[]; // 0 for Sunday, 1 for Monday, etc.
  description: string;
  startDate: string;
  endDate: string;
  startTime: string; // HH:mm format
  room?: string; // Classroom address/room
  teacherId: string;
  status: ClassStatus;
  salaryPerSession?: number; // Salary per session for the teacher
  tuitionFee?: number; // Course tuition fee (VND)
  grade?: number; // 1-12
  createdAt: string;
  updatedAt?: string;
  terms?: ClassTerm[]; // History of previous terms
  holidays?: string[]; // Class-specific holidays (YYYY-MM-DD)
  studentCounts?: {
    total: number;
    active: number;
    trial?: number;
    onLeave: number;
    dropped: number;
    promoted: number;
  };
}

export interface ClassSession {
  id: string;
  classId: string;
  teacherId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  status: 'taught' | 'cancelled' | 'makeup';
  salaryPerSession: number;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  teacherAttendanceStatus?: 'present' | 'absent';
  teacherAttendanceMarkedBy?: string;
  teacherAttendanceMarkedByRole?: 'admin' | 'office';
  teacherAttendanceMarkedAt?: string;
  teacherAttendanceNote?: string;
  // 'promotion_backfill' marks a session reconstructed by a migration rather than
  // marked by a person at the time, so payroll audits can tell the two apart.
  teacherAttendanceSource?: 'office_admin' | 'promotion_backfill';
}

export interface ClassSessionSummary {
  date: string;
  pendingAttendanceCount: number;
  absentCount: number;
  lateCount: number;
  overdueAssignmentStudentCount: number;
  riskStudentCount: number;
  completionState: 'pending_attendance' | 'attendance_done' | 'completed';
}

export interface SubstituteRequest {
  id: string;
  requestingTeacherId: string;
  requestingTeacherName: string;
  substituteTeacherId?: string;
  substituteTeacherName?: string;
  classId: string;
  className: string;
  date: string; // YYYY-MM-DD
  status: 'pending' | 'accepted' | 'cancelled' | 'completed';
  reason?: string;
  createdAt: string;
  updatedAt?: string;
  acceptedAt?: string;
}
