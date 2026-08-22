import type {
  Assignment,
  Attendance,
  Class,
  ClassSession,
  DailyReport,
  Evaluation,
  Notification as AppNotification,
  Student,
  Submission,
} from '../../types';
import { FRONTEND_LARGE_COLLECTION_LIMIT } from '../api/readLimits';
import { readChannel } from './readApi';

export const FRONTEND_READ_POLL_INTERVAL_MS = 15_000;

export type ClassDetailReadPayload = {
  class: Class;
  students: Student[];
  attendance: Attendance[];
  evaluations: Evaluation[];
  sessions: ClassSession[];
  reports: DailyReport[];
};

export type AssignmentsReadPayload = {
  assignments: Assignment[];
  submissions: Submission[];
  serverTime: number;
};

export type ClassesReadPayload = {
  classes: Class[];
  page?: {
    limit?: number;
    nextCursor?: string | null;
    hasMore?: boolean;
  };
};

export type OfficeAcademicReferencePayload = {
  classes: Class[];
  teachers: Array<{ uid: string; displayName: string; email?: string; role?: string }>;
};

export type OfficeTeacherReferencePayload = {
  teachers: Array<{
    uid: string;
    displayName: string;
    email?: string;
    phone?: string;
    role?: string;
    blockedTeacher?: boolean;
  }>;
};

export type CalendarReferencePayload = {
  classes: Class[];
  attendance: Attendance[];
  attendanceCounts: Record<string, number>;
  systemHolidays: string[];
};

export type NotificationsReadPayload = { notifications: AppNotification[] };

export function readClassDetailData(
  classId: string,
  attendanceTermStart?: string
): Promise<ClassDetailReadPayload> {
  return readChannel<ClassDetailReadPayload>('class-detail', {
    classId,
    attendanceTermStart,
    limit: FRONTEND_LARGE_COLLECTION_LIMIT,
  });
}

export function readAssignmentsData(): Promise<AssignmentsReadPayload> {
  return readChannel<AssignmentsReadPayload>('assignments', {
    limit: FRONTEND_LARGE_COLLECTION_LIMIT,
  });
}

export function readClassesData(): Promise<ClassesReadPayload> {
  return readChannel<ClassesReadPayload>('classes', {
    limit: FRONTEND_LARGE_COLLECTION_LIMIT,
  });
}

export function readOfficeAcademicReferences(): Promise<OfficeAcademicReferencePayload> {
  return readChannel<OfficeAcademicReferencePayload>('office-academic', {
    view: 'summary',
    limit: FRONTEND_LARGE_COLLECTION_LIMIT,
  });
}

export function readOfficeTeacherReferences(): Promise<OfficeTeacherReferencePayload> {
  return readChannel<OfficeTeacherReferencePayload>('office-academic', {
    view: 'teacher-references',
    limit: FRONTEND_LARGE_COLLECTION_LIMIT,
  });
}

export function readCalendarReferences(): Promise<CalendarReferencePayload> {
  const today = new Date().toISOString().slice(0, 10);
  return readChannel<CalendarReferencePayload>('calendar-window', {
    from: today,
    to: today,
    limit: FRONTEND_LARGE_COLLECTION_LIMIT,
  });
}

export function readNotificationsData(): Promise<NotificationsReadPayload> {
  return readChannel<NotificationsReadPayload>('notifications', {
    limit: FRONTEND_LARGE_COLLECTION_LIMIT,
  });
}
