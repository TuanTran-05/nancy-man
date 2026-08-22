import React from 'react';
import { UserProfile } from '../../types';
import { useTeacherDashboardData } from './hooks/useTeacherDashboardData';
import { useStudentDashboardData } from './hooks/useStudentDashboardData';
import { TeacherDashboardView } from './dashboard/TeacherDashboardView';
import { StudentDashboardView } from './dashboard/StudentDashboardView';

interface DashboardProps {
  profile: UserProfile | null;
}

const SkeletonCard = () => (
  <div className="bg-surface p-6 rounded-2xl border border-border-default shadow-sm dark:shadow-black/20 flex items-start space-x-4 animate-pulse">
    <div className="w-14 h-14 rounded-xl bg-slate-200 shrink-0"></div>
    <div className="space-y-3 w-full">
      <div className="h-4 bg-slate-200 rounded w-1/2"></div>
      <div className="h-6 bg-slate-200 rounded w-1/4"></div>
    </div>
  </div>
);

export default function Dashboard({ profile }: DashboardProps) {
  const isStudent = profile?.role === 'student';

  const teacherData = useTeacherDashboardData(isStudent ? null : profile);
  const studentData = useStudentDashboardData(isStudent ? profile : null);

  if (isStudent) {
    if (studentData.loading || !studentData.studentInsights) {
      return null;
    }
    return (
      <StudentDashboardView
        profile={profile}
        studentData={studentData.studentData}
        studentClassData={studentData.studentClassData}
        studentNotifications={studentData.studentNotifications}
        studentInsights={studentData.studentInsights}
      />
    );
  }

  if (teacherData.loading) {
    return (
      <div className="space-y-8">
        <div className="h-8 bg-slate-200 rounded w-1/4 animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="h-64 bg-slate-200 rounded-2xl animate-pulse"></div>
          <div className="h-64 bg-slate-200 rounded-2xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  return (
    <TeacherDashboardView
      profile={profile}
      stats={teacherData.stats}
      insights={teacherData.insights}
      recentSubmissions={teacherData.recentSubmissions}
      studentsData={teacherData.studentsData}
      studentNameLookup={teacherData.studentNameLookup}
      assignmentsData={teacherData.assignmentsData}
      classesData={teacherData.classesData}
      upcomingClasses={teacherData.upcomingClasses}
      teachers={teacherData.teachers}
      isNotificationModalOpen={teacherData.isNotificationModalOpen}
      setIsNotificationModalOpen={teacherData.setIsNotificationModalOpen}
      notificationSuccess={teacherData.notificationSuccess}
      handleSendNotification={teacherData.handleSendNotification}
    />
  );
}
