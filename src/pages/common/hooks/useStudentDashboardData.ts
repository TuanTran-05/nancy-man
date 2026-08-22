import { useEffect, useState, useMemo } from 'react';
import { readChannel } from '../../../lib/api/readApi';
import { FRONTEND_COLLECTION_LIMIT } from '../../../lib/api/readLimits';
import {
  Class,
  Student,
  UserProfile,
  Assignment,
  Submission,
  Notification as AppNotification,
} from '../../../types';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { translations } from '../../../lib/i18n/translations';
import { isClassVisibleForRoleOutsideAdminDashboard } from '../../../../shared/classVisibility';

export function useStudentDashboardData(profile: UserProfile | null) {
  const { language } = useLanguage();
  const { setBlockedInfo } = useAuth();

  const [studentData, setStudentData] = useState<Student | null>(null);
  const [studentClassData, setStudentClassData] = useState<Class | null>(null);
  const [studentNotifications, setStudentNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({
    assignments: 0,
  });

  const [assignmentsData, setAssignmentsData] = useState<Record<string, Assignment>>({});
  const [recentSubmissions, setRecentSubmissions] = useState<Submission[]>([]);
  const [apiInsights, setApiInsights] = useState<{
    rank: number | string;
    classification: string;
    myScore: number | null;
  } | null>(null);

  const isStudent = profile?.role === 'student';
  const classId = profile?.classId;
  const studentId = profile?.studentId;

  // 1. Student self-data listener
  useEffect(() => {
    if (isStudent && studentId) {
      let cancelled = false;
      readChannel<{ students: Student[] }>('students', { view: 'session' })
        .then((data) => {
          if (cancelled) return;
          const student = data.students[0];
          if (student) {
            const dataObj = student as Student;
            setStudentData(dataObj);
            if (dataObj.enrollmentStatus === 'dropped' || dataObj.isRevoked === true) {
              setBlockedInfo({
                email: dataObj.name || translations[language].common.student,
                reason: dataObj.isRevoked ? 'revoked' : 'dropped_student',
              });
            }
          }
        })
        .catch((error) => {
          console.error('Error loading student self-data:', error);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [isStudent, studentId, setBlockedInfo, language]);

  // 2. Student Data (one-time fetch via server read API)
  useEffect(() => {
    if (!isStudent || !classId || !studentId) return;

    let cancelled = false;

    Promise.all([
      readChannel<{ assignments: Assignment[]; submissions: Submission[] }>('assignments', {
        limit: FRONTEND_COLLECTION_LIMIT,
      }),
      readChannel<{ classes: Class[] }>('classes', {
        limit: FRONTEND_COLLECTION_LIMIT,
      }),
      readChannel<{ notifications: AppNotification[] }>('notifications', {
        limit: FRONTEND_COLLECTION_LIMIT,
      }).catch(() => ({ notifications: [] }) as { notifications: AppNotification[] }),
    ])
      .then(([assignmentsPayload, classesPayload, notifPayload]) => {
        if (cancelled) return;

        const data = (assignmentsPayload.assignments || []).reduce(
          (acc, item) => ({
            ...acc,
            [item.id]: item as Assignment,
          }),
          {}
        );
        setAssignmentsData(data);
        setStats((prev) => ({
          ...prev,
          assignments: (assignmentsPayload.assignments || []).length,
        }));

        setRecentSubmissions((assignmentsPayload.submissions || []) as Submission[]);

        const classRows = (classesPayload.classes || []) as Class[];
        if (classRows.length > 0) {
          setStudentClassData(
            isClassVisibleForRoleOutsideAdminDashboard(classRows[0], profile?.role)
              ? classRows[0]
              : null
          );
        }

        const notifs = (notifPayload.notifications || []) as AppNotification[];
        notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setStudentNotifications(notifs);

        setLoading(false);
      })
      .catch((error) => console.error('Error fetching student fast data:', error));

    // Slower API fetch for evaluations
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/students/evaluation-insights?studentId=${encodeURIComponent(studentId)}`,
          {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          }
        );
        if (res.ok) {
          const resData = await res.json();
          if (cancelled) return;
          setApiInsights({
            rank: resData.rank ?? '--',
            classification: resData.classification ?? '',
            myScore: resData.myScore,
          });
        } else {
          if (cancelled) return;
          setApiInsights({ rank: '--', classification: '', myScore: null });
        }
      } catch (e) {
        console.error('Error fetching API insights:', e);
        if (cancelled) return;
        setApiInsights({ rank: '--', classification: '', myScore: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isStudent, classId, profile?.role, studentId]);

  const studentInsights = useMemo(() => {
    if (!isStudent) return null;

    const allAssignments = Object.values(assignmentsData);
    const submittedAssignmentIds = new Set(recentSubmissions.map((s) => s.assignmentId));

    const pending = allAssignments.filter((a) => !submittedAssignmentIds.has(a.id));
    const completed = allAssignments.filter((a) => submittedAssignmentIds.has(a.id));

    pending.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    const urgent = pending.filter((a) => {
      const daysLeft = (new Date(a.dueDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24);
      return daysLeft >= 0 && daysLeft <= 2;
    });

    const progress =
      allAssignments.length > 0 ? Math.round((completed.length / allAssignments.length) * 100) : 0;

    const displayRecent = [...allAssignments]
      .sort((a, b) => {
        const aPending = !submittedAssignmentIds.has(a.id);
        const bPending = !submittedAssignmentIds.has(b.id);
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 5);

    const gradedSubmissions = recentSubmissions.filter(
      (s) =>
        s.status === 'graded' &&
        s.grade !== undefined &&
        s.grade !== null &&
        !isNaN(Number(s.grade))
    );
    let averageScore: number | string = '--';
    if (gradedSubmissions.length > 0) {
      const sum = gradedSubmissions.reduce((acc, curr) => acc + Number(curr.grade), 0);
      averageScore = (sum / gradedSubmissions.length).toFixed(1);
    }

    const rank = apiInsights?.rank ?? '--';
    const totalStudentsForRank = studentClassData?.studentCounts?.active || '--';
    const classification = apiInsights?.classification ?? '';

    return {
      pending,
      completed,
      urgent,
      progress,
      total: allAssignments.length,
      displayRecent,
      submittedAssignmentIds,
      averageScore,
      rank,
      totalStudentsForRank,
      classification,
    };
  }, [assignmentsData, recentSubmissions, isStudent, apiInsights, studentClassData]);

  return {
    studentData,
    studentClassData,
    studentNotifications,
    loading,
    stats,
    studentInsights,
  };
}
