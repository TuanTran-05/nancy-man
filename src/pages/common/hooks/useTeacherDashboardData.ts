import { useEffect, useMemo, useState } from 'react';
import { format, isThisWeek, isToday, parseISO } from 'date-fns';
import { apiRequest } from '../../../lib/api/apiClient';
import { readChannel } from '../../../lib/api/readApi';
import {
  FRONTEND_READ_POLL_INTERVAL_MS,
  readAssignmentsData,
  readClassDetailData,
  readClassesData,
} from '../../../lib/api/frontendReadApi';
import { FRONTEND_LARGE_COLLECTION_LIMIT } from '../../../lib/api/readLimits';
import type { Assignment, Class, Student, Submission, UserProfile } from '../../../types';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { translations } from '../../../lib/i18n/translations';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../../shared/classVisibility';
import { getClassSessionForDate } from '../../../../shared/classSchedule';

function asDate(value: unknown): Date | null {
  try {
    if (typeof value === 'string') return parseISO(value);
    if (value instanceof Date) return value;
    if (value && typeof value === 'object') {
      const record = value as { toDate?: () => Date; seconds?: number };
      if (typeof record.toDate === 'function') return record.toDate();
      if (typeof record.seconds === 'number') return new Date(record.seconds * 1000);
    }
  } catch {
    return null;
  }
  return null;
}

export function useTeacherDashboardData(profile: UserProfile | null) {
  const { language } = useLanguage();
  const t = translations[language].dashboard;
  const [stats, setStats] = useState({
    classes: 0,
    students: 0,
    activeStudents: 0,
    evaluations: 0,
    assignments: 0,
  });
  const [insights, setInsights] = useState({
    newStudentsThisWeek: 0,
    evaluationsToday: 0,
    ungradedSubmissions: 0,
    newSubmissionsToday: 0,
  });
  const [recentSubmissions, setRecentSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentsData, setStudentsData] = useState<Record<string, Student>>({});
  const [studentNameLookup, setStudentNameLookup] = useState<Record<string, string>>({});
  const [assignmentsData, setAssignmentsData] = useState<Record<string, Assignment>>({});
  const [classesData, setClassesData] = useState<Record<string, Class>>({});
  const [isStudentsLoaded, setIsStudentsLoaded] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [notificationSuccess, setNotificationSuccess] = useState<string | null>(null);
  const [classesList, setClassesList] = useState<Class[]>([]);
  const teachers = useMemo<Record<string, UserProfile>>(() => ({}), []);

  const isTeacher = profile?.role === 'teacher';
  const userId = profile?.uid;

  useEffect(() => {
    if (!isTeacher || !userId) return;
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const [classResult, studentResult, assignmentResult] = await Promise.allSettled([
          readClassesData(),
          readChannel<{ students: Student[] }>('students', {
            view: 'academic',
            limit: FRONTEND_LARGE_COLLECTION_LIMIT,
          }),
          readAssignmentsData(),
        ]);
        if (cancelled) return;

        const failures = [classResult, studentResult, assignmentResult].filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        if (failures.length === 3) throw failures[0].reason;
        for (const failure of failures) {
          console.error('Partial teacher dashboard read failed:', failure.reason);
        }

        const classPayload =
          classResult.status === 'fulfilled' ? classResult.value : { classes: [] };
        const studentPayload =
          studentResult.status === 'fulfilled' ? studentResult.value : { students: [] };
        const assignmentPayload =
          assignmentResult.status === 'fulfilled'
            ? assignmentResult.value
            : { assignments: [], submissions: [] };

        const classes = filterClassesForRoleOutsideAdminDashboard(
          classPayload.classes || [],
          profile?.role
        );
        const students = studentPayload.students || [];
        const assignments = assignmentPayload.assignments || [];
        const submissions = assignmentPayload.submissions || [];

        setClassesList(classes);
        setClassesData(Object.fromEntries(classes.map((row) => [row.id, row])));
        setStudentIds(students.map((row) => row.id));
        setStudentsData(Object.fromEntries(students.map((row) => [row.id, row])));
        setStudentNameLookup(Object.fromEntries(students.map((row) => [row.id, row.name])));
        setAssignmentsData(Object.fromEntries(assignments.map((row) => [row.id, row])));
        setIsStudentsLoaded(true);

        const newStudentsThisWeek = students.filter((row) => {
          const date = asDate(row.createdAt);
          return Boolean(date && !Number.isNaN(date.getTime()) && isThisWeek(date));
        }).length;
        const activeStudents = students.filter(
          (row) => row.enrollmentStatus === 'active' || !row.enrollmentStatus
        ).length;

        let ungradedSubmissions = 0;
        let newSubmissionsToday = 0;
        const latestAttempts = new Set<string>();
        const sortedSubmissions = [...submissions].sort((left, right) =>
          String(right.submittedAt || '').localeCompare(String(left.submittedAt || ''))
        );
        for (const submission of sortedSubmissions) {
          const attemptKey = `${submission.assignmentId}_${submission.studentId}`;
          if (!latestAttempts.has(attemptKey)) {
            latestAttempts.add(attemptKey);
            if (submission.status !== 'graded') ungradedSubmissions += 1;
          }
          const submittedAt = asDate(submission.submittedAt);
          if (submittedAt && isToday(submittedAt)) newSubmissionsToday += 1;
        }
        setRecentSubmissions(sortedSubmissions.slice(0, 5));

        const details = await Promise.all(classes.map((row) => readClassDetailData(row.id)));
        if (cancelled) return;
        const evaluations = details.flatMap((detail) => detail.evaluations || []);
        const evaluationsToday = evaluations.filter((evaluation) => {
          const date = asDate(evaluation.date);
          return Boolean(date && isToday(date));
        }).length;

        setStats({
          classes: classes.length,
          students: students.length,
          activeStudents,
          evaluations: evaluations.length,
          assignments: assignments.length,
        });
        setInsights({
          newStudentsThisWeek,
          evaluationsToday,
          ungradedSubmissions,
          newSubmissionsToday,
        });
      } catch (error) {
        if (!cancelled) console.error('Error loading teacher dashboard through read API:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadDashboard();
    const interval = window.setInterval(() => void loadDashboard(), FRONTEND_READ_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isTeacher, profile?.role, userId]);

  const upcomingClasses = useMemo(() => {
    if (!isTeacher || classesList.length === 0) return [];
    const today = new Date();
    const currentDay = today.getDay();
    const sessions: { class: Class; dayOffset: number; date: Date; sessionTime: string }[] = [];

    for (const classRow of classesList) {
      if (classRow.status !== 'active' || !classRow.daysOfWeek?.length) continue;
      for (const day of classRow.daysOfWeek) {
        let dayOffset = day - currentDay;
        if (dayOffset < 0) dayOffset += 7;
        const classDate = new Date(today);
        classDate.setDate(today.getDate() + dayOffset);
        const session = getClassSessionForDate(classRow, format(classDate, 'yyyy-MM-dd'));
        if (session) {
          sessions.push({ class: classRow, dayOffset, date: classDate, sessionTime: session.startTime });
        }
      }
    }

    return sessions
      .sort((left, right) =>
        left.dayOffset !== right.dayOffset
          ? left.dayOffset - right.dayOffset
          : left.sessionTime.localeCompare(right.sessionTime)
      )
      .slice(0, 4);
  }, [classesList, isTeacher]);

  const handleSendNotification = async (
    studentId: string,
    title: string,
    message: string,
    type: string
  ) => {
    try {
      await apiRequest('/api/v1/messages/send-notification', {
        method: 'POST',
        body: { studentId, title, message, type, classId: '' },
      });
      setNotificationSuccess(t.teacher.notifSuccess);
      setTimeout(() => setNotificationSuccess(null), 3000);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  };

  return {
    stats,
    insights,
    recentSubmissions,
    loading,
    studentIds,
    studentsData,
    studentNameLookup,
    assignmentsData,
    classesData,
    isStudentsLoaded,
    classesList,
    upcomingClasses,
    teachers,
    isNotificationModalOpen,
    setIsNotificationModalOpen,
    notificationSuccess,
    setNotificationSuccess,
    handleSendNotification,
  };
}
