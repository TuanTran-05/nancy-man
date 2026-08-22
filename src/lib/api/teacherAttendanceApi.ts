import { apiRequest } from './apiClient';
import { readChannel } from './readApi';

export type TeacherAttendanceDisplayStatus = 'pending' | 'present' | 'absent';

export interface TeacherAttendanceSessionRow {
  id: string;
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  date: string;
  startTime?: string;
  schedule?: string;
  room?: string;
  sessionStatus: 'taught' | 'cancelled' | 'makeup';
  sessionKind: 'scheduled' | 'makeup' | 'cancelled';
  isVirtual: boolean;
  teacherAttendanceStatus: TeacherAttendanceDisplayStatus;
  teacherAttendanceNote?: string;
  teacherAttendanceMarkedAt?: string;
  teacherAttendanceMarkedBy?: string;
  canMark: boolean;
  disabledReason?: 'future' | 'cancelled' | 'out_of_range';
}

export interface TeacherAttendanceWeekResponse {
  sessions: TeacherAttendanceSessionRow[];
  teachers: Array<{ uid: string; displayName: string; email?: string }>;
  classes: Array<{ id: string; name: string; schedule?: string; room?: string }>;
  serverTime: number;
}

export function readTeacherAttendanceWeek(from: string, to: string) {
  return readChannel<TeacherAttendanceWeekResponse>('teacher-attendance-week', { from, to });
}

export function markTeacherAttendance(input: {
  classId: string;
  date: string;
  status: 'present' | 'absent';
  note?: string;
}) {
  return apiRequest<{ success: true; id: string; status: 'present' | 'absent' }>(
    '/api/v1/teacher-attendance/mark',
    {
      method: 'POST',
      body: input,
    }
  );
}
