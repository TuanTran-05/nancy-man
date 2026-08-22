import { lazy } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { UserProfile } from '../types';
import PageTransition from '../components/common/PageTransition';
import Login from '../pages/login/Login';
import { ProtectedRoute } from './ProtectedRoute';
import { ManagementTabs } from './ManagementTabs';

const Dashboard = lazy(() => import('../pages/common/Dashboard'));
const Classes = lazy(() => import('../pages/common/Classes'));
const Students = lazy(() => import('../pages/common/Students'));
const ClassDetail = lazy(() => import('../pages/common/ClassDetail'));
const Assignments = lazy(() => import('../pages/common/Assignments'));
const AssignmentAuthoringWorkbench = lazy(
  () => import('../pages/common/AssignmentAuthoringWorkbench')
);
const ParentDashboard = lazy(() => import('../pages/parent/ParentDashboard'));
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const PasswordResetRequests = lazy(() => import('../pages/common/PasswordResetRequests'));
const StaffPasswordResetRequests = lazy(() => import('../pages/admin/StaffPasswordResetRequests'));
const KnowledgeBank = lazy(() => import('../pages/common/KnowledgeBank'));
const KnowledgeBankGrade = lazy(() => import('../pages/common/KnowledgeBankGrade'));
const KnowledgeBankUnit = lazy(() => import('../pages/common/KnowledgeBankUnit'));
const LessonPlayer = lazy(() => import('../components/knowledge/LessonPlayer'));
const GameZone = lazy(() => import('../pages/teacher/GameZone'));
const LuckyLens = lazy(() => import('../pages/teacher/LuckyLens'));
const LuckyWheel = lazy(() => import('../pages/teacher/LuckyWheel'));
const Profile = lazy(() => import('../pages/common/Profile'));
const Reports = lazy(() => import('../pages/common/Reports'));
const Finance = lazy(() => import('../pages/accounting/Finance'));
const Payroll = lazy(() => import('../pages/accounting/Payroll'));
const CalendarView = lazy(() => import('../pages/common/CalendarView'));
const SubstituteRequests = lazy(() => import('../pages/common/SubstituteRequests'));
const AuditLog = lazy(() => import('../pages/admin/AuditLog'));
const ZaloOA = lazy(() => import('../pages/admin/ZaloOA'));
const ParentTuition = lazy(() => import('../pages/parent/ParentTuition'));
const Admissions = lazy(() => import('../pages/office/Admissions'));
const Academic = lazy(() => import('../pages/office/Academic'));
const TeacherAttendance = lazy(() => import('../pages/office/TeacherAttendance'));
const Teachers = lazy(() => import('../pages/office/Teachers'));
const TeacherAvailability = lazy(() => import('../pages/common/TeacherAvailability'));
const PrintSupport = lazy(() => import('../pages/common/PrintSupport'));
const OfficeDashboard = lazy(() => import('../pages/office/OfficeDashboard'));
const BlockDevToolPage = lazy(() => import('../pages/common/BlockDevToolPage'));
const StudentProfilePage = lazy(() => import('../pages/common/StudentProfilePage'));
const FinanceReport = lazy(() => import('../pages/admin/FinanceReport'));

const CourseClosingRecordsPage = lazy(() =>
  import('../features/course-closing-records/pages/CourseClosingRecordsPage').then((m) => ({
    default: m.CourseClosingRecordsPage,
  }))
);

export const AnimatedRoutes = ({ user, profile }: { user: any; profile: UserProfile | null }) => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/course-closing-records"
          element={
            <ProtectedRoute allowedRoles={['admin', 'office', 'accounting']}>
              <PageTransition>
                <CourseClosingRecordsPage userRole={profile?.role || ''} />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/login"
          element={
            !user || !profile ? (
              <PageTransition>
                <Login />
              </PageTransition>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/blockdevtool"
          element={
            <PageTransition>
              <BlockDevToolPage />
            </PageTransition>
          }
        />

        {/* Common Dashboard */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <PageTransition>
                {profile?.role === 'admin' ? (
                  <Navigate to="/admin" />
                ) : profile?.role === 'accounting' ? (
                  <Navigate to="/tuition" />
                ) : profile?.role === 'office' ? (
                  <Navigate to="/office-dashboard" />
                ) : profile?.role === 'parent' ? (
                  <ParentDashboard profile={profile} />
                ) : (
                  <Dashboard profile={profile} />
                )}
              </PageTransition>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['admin', 'office']}>
              <PageTransition>
                <AdminDashboard />
              </PageTransition>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/staff-password-resets"
          element={
            <ProtectedRoute requiredRole="admin">
              <PageTransition>
                <StaffPasswordResetRequests />
              </PageTransition>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/finance-report"
          element={
            <ProtectedRoute requiredRole="admin">
              <PageTransition>
                <FinanceReport />
              </PageTransition>
            </ProtectedRoute>
          }
        />

        <Route
          path="/classes"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'office']}>
              <PageTransition>
                <ManagementTabs group="classes" role={profile?.role} />
                <Classes />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/classes/:classId"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'office']}>
              <PageTransition>
                <ClassDetail profile={profile} />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/students"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'office', 'accounting']}>
              <PageTransition>
                {profile?.role === 'accounting' ? (
                  <Navigate to="/tuition?tab=students" replace />
                ) : (
                  <Students />
                )}
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/students/:studentId/report"
          element={<Navigate to=".." relative="path" replace />}
        />
        <Route
          path="/students/:studentId"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'office', 'accounting']}>
              <PageTransition>
                <StudentProfilePage />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/office-dashboard"
          element={
            <ProtectedRoute requiredRole="office">
              <PageTransition>
                <OfficeDashboard />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/academic"
          element={
            <ProtectedRoute allowedRoles={['admin', 'office']}>
              <PageTransition>
                <Academic />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admissions"
          element={
            <ProtectedRoute allowedRoles={['admin', 'office']}>
              <PageTransition>
                <Admissions />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher-attendance"
          element={
            <ProtectedRoute allowedRoles={['admin', 'office']}>
              <PageTransition>
                <ManagementTabs group="teachers" role={profile?.role} />
                <TeacherAttendance />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers"
          element={
            <ProtectedRoute allowedRoles={['admin', 'office']}>
              <PageTransition>
                <ManagementTabs group="teachers" role={profile?.role} />
                <Teachers />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher-availability"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin', 'office']}>
              <PageTransition>
                <ManagementTabs group="teachers" role={profile?.role} />
                <TeacherAvailability />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/print-support"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'office']}>
              <PageTransition>
                <PrintSupport />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assignments/advanced/new"
          element={
            <ProtectedRoute allowedRoles={['teacher']}>
              <PageTransition>
                <AssignmentAuthoringWorkbench profile={profile} />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assignments/advanced/:draftId"
          element={
            <ProtectedRoute allowedRoles={['teacher']}>
              <PageTransition>
                <AssignmentAuthoringWorkbench profile={profile} />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assignments"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'student']}>
              <PageTransition>
                <Assignments profile={profile} />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route path="/messages" element={<Navigate to="/" replace />} />
        <Route
          path="/tuition"
          element={
            <ProtectedRoute allowedRoles={['admin', 'accounting']}>
              <PageTransition>
                <Finance />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounting/students"
          element={<Navigate to="/tuition?tab=students" replace />}
        />
        <Route
          path="/payroll"
          element={
            <ProtectedRoute allowedRoles={['accounting']}>
              <PageTransition>
                <Payroll />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <PageTransition>
                <CalendarView />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/knowledge-bank"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <PageTransition>
                <ManagementTabs group="classes" role={profile?.role} />
                <KnowledgeBank profile={profile} />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/knowledge-bank/global-success/:gradeSlug"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <PageTransition>
                <KnowledgeBankGrade />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/knowledge-bank/global-success/:gradeSlug/:unitSlug"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <PageTransition>
                <KnowledgeBankUnit profile={profile} />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lesson-player/:deckId"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <LessonPlayer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/game-zone"
          element={
            <ProtectedRoute requiredRole="teacher">
              <PageTransition>
                <GameZone />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lucky-lens"
          element={
            <ProtectedRoute requiredRole="teacher">
              <PageTransition>
                <LuckyLens />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lucky-wheel"
          element={
            <ProtectedRoute requiredRole="teacher">
              <PageTransition>
                <LuckyWheel />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <PageTransition>
                <Reports />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/password-resets"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'office']}>
              <PageTransition>
                <PasswordResetRequests />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/substitute-requests"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <PageTransition>
                <ManagementTabs group="classes" role={profile?.role} />
                <SubstituteRequests />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Profile profile={profile} />
              </PageTransition>
            </ProtectedRoute>
          }
        />

        <Route
          path="/audit-log"
          element={
            <ProtectedRoute requiredRole="admin">
              <PageTransition>
                <AuditLog />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/zalo-oa"
          element={
            <ProtectedRoute requiredRole="admin">
              <PageTransition>
                <ZaloOA />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/parent/tuition"
          element={
            <ProtectedRoute requiredRole="parent">
              <PageTransition>
                <ParentTuition />
              </PageTransition>
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AnimatePresence>
  );
};
