import { useState, useEffect, useCallback } from 'react';
import { readChannel } from '../lib/api/readApi';
import { useInvalidationRefresh } from './useInvalidationRefresh';
import {
  Assignment,
  Attendance,
  Class,
  Evaluation,
  Notification,
  Submission,
  UserProfile,
} from '../types';

type ParentDashboardPayload = {
  student?: Record<string, any> | null;
  class?: Class | null;
  classInfo?: Class | null;
  assignments?: Assignment[];
  attendance?: Attendance[];
  evaluations?: Evaluation[];
  submissions?: Submission[];
  notifications?: Notification[];
  tuition?: {
    ledgers?: Record<string, any>[];
    receipts?: Record<string, any>[];
  };
};

type ParentDashboardResponse = {
  dashboard?: ParentDashboardPayload;
} & ParentDashboardPayload;

function getDashboardPayload(data: ParentDashboardResponse): ParentDashboardPayload {
  return data.dashboard || data;
}

function resetDashboardState(
  setStudentData: (value: Record<string, any> | null) => void,
  setClassData: (value: Class | null) => void,
  setAssignments: (value: Assignment[]) => void,
  setAttendance: (value: Attendance[]) => void,
  setEvaluations: (value: Evaluation[]) => void,
  setSubmissions: (value: Submission[]) => void,
  setNotifications: (value: Notification[]) => void
) {
  setStudentData(null);
  setClassData(null);
  setAssignments([]);
  setAttendance([]);
  setEvaluations([]);
  setSubmissions([]);
  setNotifications([]);
}

export function useParentDashboardData(profile: UserProfile | null) {
  const [classData, setClassData] = useState<Class | null>(null);
  const [studentData, setStudentData] = useState<Record<string, any> | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(() => !!profile?.studentId);

  const refreshParentDashboard = useCallback(async () => {
    if (!profile?.studentId) return;
    try {
      const data = await readChannel<ParentDashboardResponse>('parent-dashboard');
      const dashboard = getDashboardPayload(data);
      const studentRecord = dashboard.student || null;
      if (!studentRecord) return;
      setStudentData(studentRecord);
      setClassData((dashboard.classInfo || dashboard.class || null) as Class | null);
      setAssignments((dashboard.assignments || []) as Assignment[]);
      setAttendance((dashboard.attendance || []) as Attendance[]);
      setEvaluations((dashboard.evaluations || []) as Evaluation[]);
      setSubmissions((dashboard.submissions || []) as Submission[]);
      setNotifications((dashboard.notifications || []) as Notification[]);
    } catch (err) {
      console.error('[useParentDashboardData] refresh failed:', err);
    }
  }, [profile?.studentId]);

  useInvalidationRefresh({
    channelKey: 'parent-dashboard',
    enabled: !!profile?.studentId,
    onInvalidate: refreshParentDashboard,
  });

  // Main dashboard data is loaded as one bounded server payload.
  useEffect(() => {
    if (!profile?.studentId) {
      resetDashboardState(
        setStudentData,
        setClassData,
        setAssignments,
        setAttendance,
        setEvaluations,
        setSubmissions,
        setNotifications
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    readChannel<ParentDashboardResponse>('parent-dashboard')
      .then((data) => {
        if (cancelled) return;

        const dashboard = getDashboardPayload(data);
        const studentRecord = dashboard.student || null;
        if (!studentRecord) {
          resetDashboardState(
            setStudentData,
            setClassData,
            setAssignments,
            setAttendance,
            setEvaluations,
            setSubmissions,
            setNotifications
          );
          setLoading(false);
          return;
        }

        setStudentData(studentRecord);
        setClassData((dashboard.classInfo || dashboard.class || null) as Class | null);
        setAssignments((dashboard.assignments || []) as Assignment[]);
        setAttendance((dashboard.attendance || []) as Attendance[]);
        setEvaluations((dashboard.evaluations || []) as Evaluation[]);
        setSubmissions((dashboard.submissions || []) as Submission[]);
        setNotifications((dashboard.notifications || []) as Notification[]);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        resetDashboardState(
          setStudentData,
          setClassData,
          setAssignments,
          setAttendance,
          setEvaluations,
          setSubmissions,
          setNotifications
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.studentId, profile?.classId]);

  return {
    classData,
    setClassData,
    studentData,
    evaluations,
    attendance,
    assignments,
    submissions,
    notifications,
    loading,
  };
}
