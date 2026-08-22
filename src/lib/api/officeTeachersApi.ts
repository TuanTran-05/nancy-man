import { readChannel } from './readApi';

export type OfficeTeacherProfile = {
  uid: string;
  displayName: string;
  email?: string;
  phone?: string;
  blockedTeacher?: boolean;
};

export type OfficeTeacherClassTerm = {
  id?: string;
  name?: string;
  startDate: string;
  endDate: string;
};

export type WeeklyClassSessionDto = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
};

export type OfficeTeacherClass = {
  id: string;
  name: string;
  teacherId: string;
  schedule?: string;
  daysOfWeek: number[];
  startDate: string;
  endDate?: string;
  startTime?: string;
  room?: string;
  status?: string;
  salaryPerSession?: number;
  holidays?: string[];
  terms?: OfficeTeacherClassTerm[];
  weeklySessions?: WeeklyClassSessionDto[];
};

export type OfficeTeacherSession = {
  id: string;
  classId: string;
  teacherId: string;
  date: string;
  status: 'taught' | 'cancelled' | 'makeup';
  teacherAttendanceStatus?: 'present' | 'absent';
  teacherAttendanceMarkedAt?: string;
  teacherAttendanceNote?: string;
  salaryPerSession?: number;
};

export type OfficeTeacherSubstitute = {
  classId: string;
  date: string;
  substituteTeacherId: string;
};

export type OfficeTeachersMonthResponse = {
  month: string;
  range: { from: string; to: string };
  teachers: OfficeTeacherProfile[];
  classes: OfficeTeacherClass[];
  sessions: OfficeTeacherSession[];
  substitutes: OfficeTeacherSubstitute[];
  serverTime: number;
};

export function readOfficeTeachersMonth(month: string) {
  return readChannel<OfficeTeachersMonthResponse>('office-teachers-month', { month });
}
