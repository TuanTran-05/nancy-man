import React, { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { apiRequest } from '../../../lib/api/apiClient';
import {
  Student,
  Attendance,
  Evaluation,
  QuickNotifyTemplateKey,
  StudentClassroomRisk,
} from '../../../types';
import { calculateStudentRisk } from '../../../lib/student/riskAssessment';

export function useStudentActionRoster({
  classroomStudents,
  attendanceData,
  fourteenDayStr,
  todayStr,
  overdueAssignmentCountByStudent,
  evaluations,
  todayAttendanceMap,
  classData,
  t,
}: {
  classroomStudents: Student[];
  attendanceData: Attendance[];
  fourteenDayStr: string;
  todayStr: string;
  overdueAssignmentCountByStudent: Map<string, number>;
  evaluations: Evaluation[];
  todayAttendanceMap: Map<string, Attendance>;
  classData: any;
  t: any;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [rosterSearchTerm, setRosterSearchTerm] = useState('');
  const [rosterFilter, setRosterFilter] = useState<
    'all' | 'unmarked' | 'absent' | 'late' | 'missing_assignment' | 'risk'
  >('all');

  const [isQuickNotifyModalOpen, setIsQuickNotifyModalOpen] = useState(false);
  const [notifyStudentIds, setNotifyStudentIds] = useState<string[]>([]);
  const [defaultNotifyTemplate, setDefaultNotifyTemplate] =
    useState<QuickNotifyTemplateKey>('absence_today');
  const [sendingNotificationId, setSendingNotificationId] = useState<string | null>(null);

  const riskByStudent = useMemo(() => {
    return calculateStudentRisk(
      classroomStudents,
      attendanceData,
      fourteenDayStr,
      todayStr,
      overdueAssignmentCountByStudent,
      evaluations,
      t
    );
  }, [
    classroomStudents,
    attendanceData,
    fourteenDayStr,
    todayStr,
    overdueAssignmentCountByStudent,
    evaluations,
    t,
  ]);

  const handleSendNotification = async (
    studentId: string,
    title: string,
    message: string,
    type: 'absence' | 'missing_assignment' | 'general',
    templateKey?: QuickNotifyTemplateKey,
    contextDate?: string
  ) => {
    try {
      setSendingNotificationId(studentId);
      await apiRequest('/api/v1/messages/send-notification', {
        method: 'POST',
        body: {
          studentId,
          title,
          message,
          type,
          classId: classData?.id,
          templateKey,
          contextDate,
        },
      });
      toast.success(t.notifSent);
    } catch (error) {
      console.error('Error sending notification:', error);
      toast.error(t.notifError);
    } finally {
      setSendingNotificationId(null);
    }
  };

  const openQuickNotify = (
    studentIds: string[],
    templateKey: QuickNotifyTemplateKey = 'absence_today'
  ) => {
    if (studentIds.length === 0) {
      toast.error(t.noStudentsForNotif);
      return;
    }

    setNotifyStudentIds(studentIds);
    setDefaultNotifyTemplate(templateKey);
    setIsQuickNotifyModalOpen(true);
  };

  const actionRosterStudents = useMemo(() => {
    return classroomStudents
      .filter((student) => {
        const matchesSearch =
          student.name.toLowerCase().includes(rosterSearchTerm.toLowerCase()) ||
          student.studentId.toLowerCase().includes(rosterSearchTerm.toLowerCase());
        if (!matchesSearch) return false;

        const todayAttendance = todayAttendanceMap.get(student.id);
        const risk = riskByStudent.get(student.id);
        const overdueCount = overdueAssignmentCountByStudent.get(student.id) || 0;

        switch (rosterFilter) {
          case 'unmarked':
            return student.enrollmentStatus !== 'on_leave' && !todayAttendance;
          case 'absent':
            return todayAttendance?.status === 'absent';
          case 'late':
            return todayAttendance?.status === 'late';
          case 'missing_assignment':
            return overdueCount > 0;
          case 'risk':
            return risk?.level !== 'low';
          default:
            return true;
        }
      })
      .sort((left, right) => {
        const leftAttendance = todayAttendanceMap.get(left.id);
        const rightAttendance = todayAttendanceMap.get(right.id);
        const leftRisk = riskByStudent.get(left.id);
        const rightRisk = riskByStudent.get(right.id);

        const getPriority = (
          student: Student,
          attendance: Attendance | undefined,
          risk: StudentClassroomRisk | undefined
        ) => {
          if (student.enrollmentStatus !== 'on_leave' && !attendance) return 0;
          if (risk?.level === 'high' || risk?.level === 'medium') return 1;
          if (attendance?.status === 'absent' || attendance?.status === 'late') return 2;
          return 3;
        };

        const priorityDiff =
          getPriority(left, leftAttendance, leftRisk) -
          getPriority(right, rightAttendance, rightRisk);
        if (priorityDiff !== 0) return priorityDiff;
        return left.name.localeCompare(right.name);
      });
  }, [
    classroomStudents,
    rosterSearchTerm,
    rosterFilter,
    todayAttendanceMap,
    riskByStudent,
    overdueAssignmentCountByStudent,
  ]);

  const actionRosterStudentIds = useMemo(
    () => actionRosterStudents.map((s) => s.id),
    [actionRosterStudents]
  );

  return {
    searchTerm,
    setSearchTerm,
    rosterSearchTerm,
    setRosterSearchTerm,
    rosterFilter,
    setRosterFilter,
    isQuickNotifyModalOpen,
    setIsQuickNotifyModalOpen,
    notifyStudentIds,
    setNotifyStudentIds,
    defaultNotifyTemplate,
    setDefaultNotifyTemplate,
    sendingNotificationId,
    riskByStudent,
    actionRosterStudents,
    actionRosterStudentIds,
    handleSendNotification,
    openQuickNotify,
  };
}
