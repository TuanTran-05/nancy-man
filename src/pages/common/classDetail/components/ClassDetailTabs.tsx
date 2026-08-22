import type React from 'react';
import { TrendingUp, UserCheck, Users } from 'lucide-react';

import { useLanguage } from '../../../../lib/i18n/useLanguage';
import { ClassAttendanceTab } from '../../../../components/classDetail/ClassAttendanceTab';
import { ClassExportControls } from '../../../../components/classDetail/ClassExportControls';
import { ClassStudentsTab } from '../../../../components/classDetail/ClassStudentsTab';
import { CourseClosingApprovalPanel } from '../../../../components/classDetail/CourseClosingApprovalPanel';
import type { UseCourseClosingResult } from '../../hooks/useCourseClosing';
import type {
  Attendance,
  Class,
  ClassSession,
  Evaluation,
  Student,
  UserProfile,
} from '../../../../types';
import { cn } from '../../../../lib/core/utils';
import Reports from '../../Reports';

type ActiveTab = 'students' | 'attendance' | 'reports';
type CoursePeriod = { start: string; end: string };

type ClassDetailTabsProps = {
  activeTab: ActiveTab;
  setActiveTab: React.Dispatch<React.SetStateAction<ActiveTab>>;
  profile: UserProfile | null;
  classData: Class;
  courseClosing: UseCourseClosingResult;
  coursePeriod: CoursePeriod;
  setCoursePeriod: React.Dispatch<React.SetStateAction<CoursePeriod>>;
  selectedMonth: Date;
  setSelectedMonth: React.Dispatch<React.SetStateAction<Date>>;
  exportWord: () => Promise<void>;
  isExporting: boolean;
  reportDataLength: number;
  students: Student[];
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  filteredClassEvaluations: Evaluation[];
  handleEditEval: (ev: Evaluation, student: Student) => void;
  handleDeleteEval: (id: string) => void | Promise<void>;
  handleOpenEvalSelect: (
    student: Student,
    midtermEval: Evaluation | null,
    finalEval: Evaluation | null
  ) => void;
  isArchived: boolean;
  isPaused: boolean;
  handleSendZaloFromCard: React.ComponentProps<typeof ClassStudentsTab>['onSendZaloEvaluation'];
  isSendingZalo: boolean;
  attendanceData: Attendance[];
  classDates: Date[];
  handleAttendanceToggle: React.ComponentProps<typeof ClassAttendanceTab>['onAttendanceToggle'];
  handleMarkAllPresent: React.ComponentProps<typeof ClassAttendanceTab>['onMarkAllPresent'];
  handleMarkAllPresentError?: React.ComponentProps<
    typeof ClassAttendanceTab
  >['onMarkAllPresentError'];
  setSelectedAttendanceForDetail: React.Dispatch<React.SetStateAction<Attendance | null>>;
  setNotifyAbsenceDate: React.Dispatch<React.SetStateAction<string | null>>;
  exportAttendanceReport: () => Promise<void>;
  handleDeleteDates: (dates: string[]) => Promise<void>;
  classSessions: ClassSession[];
  handleConfirmSession?: (date: string, status: 'taught' | 'cancelled' | 'makeup') => Promise<void>;
  isTogglingAttendance: boolean;
  isAttendancePending: (studentId: string, date: string) => boolean;
  confirmingSessionDate: string | null;
  onOpenAttendanceStudent: (student: Student) => void;
  selectedAttendanceStudentId: string | null;
  onSelectedAttendanceStudentHidden: () => void;
  attendanceStudents?: Student[];
  termScope?: React.ComponentProps<typeof ClassAttendanceTab>['termScope'];
  onAttendanceOverrideRequested?: React.ComponentProps<
    typeof ClassAttendanceTab
  >['onAttendanceOverrideRequested'];
};

export function ClassDetailTabs({
  activeTab,
  setActiveTab,
  profile,
  classData,
  courseClosing,
  coursePeriod,
  setCoursePeriod,
  selectedMonth,
  setSelectedMonth,
  exportWord,
  isExporting,
  reportDataLength,
  students,
  searchTerm,
  setSearchTerm,
  filteredClassEvaluations,
  handleEditEval,
  handleDeleteEval,
  handleOpenEvalSelect,
  isArchived,
  isPaused,
  handleSendZaloFromCard,
  isSendingZalo,
  attendanceData,
  classDates,
  handleAttendanceToggle,
  handleMarkAllPresent,
  handleMarkAllPresentError,
  setSelectedAttendanceForDetail,
  setNotifyAbsenceDate,
  exportAttendanceReport,
  handleDeleteDates,
  classSessions,
  handleConfirmSession,
  isTogglingAttendance,
  isAttendancePending,
  confirmingSessionDate,
  onOpenAttendanceStudent,
  selectedAttendanceStudentId,
  onSelectedAttendanceStudentHidden,
  attendanceStudents,
  termScope,
  onAttendanceOverrideRequested,
}: ClassDetailTabsProps) {
  const { t } = useLanguage();
  const isOffice = profile?.role === 'office';

  return (
    <>
      {/* Tabs */}
      <div className="flex border-b border-border-default">
        {!isOffice && (
          <button
            onClick={() => setActiveTab('reports')}
            className={cn(
              'px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center space-x-2',
              activeTab === 'reports'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <TrendingUp className="w-4 h-4" />
            <span>{t.classDetail.tabs.reports}</span>
          </button>
        )}
        {(profile?.role === 'teacher' ||
          profile?.role === 'admin' ||
          profile?.role === 'office') && (
          <button
            onClick={() => setActiveTab('students')}
            className={cn(
              'px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center space-x-2',
              activeTab === 'students'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <Users className="w-4 h-4" />
            <span>{t.classDetail.tabs.students}</span>
          </button>
        )}
        {(profile?.role === 'teacher' ||
          profile?.role === 'admin' ||
          profile?.role === 'office') && (
          <button
            onClick={() => setActiveTab('attendance')}
            className={cn(
              'px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center space-x-2',
              activeTab === 'attendance'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <UserCheck className="w-4 h-4" />
            <span>{t.classDetail.tabs.attendance}</span>
          </button>
        )}
      </div>

      {activeTab === 'reports' && !isOffice ? (
        <div className="pt-6">
          <Reports defaultClassId={classData.id} embedded={true} />
        </div>
      ) : activeTab === 'students' &&
        (profile?.role === 'teacher' || profile?.role === 'admin' || profile?.role === 'office') ? (
        <>
          {!isOffice && (
            <ClassExportControls
              classData={classData}
              coursePeriod={coursePeriod}
              setCoursePeriod={setCoursePeriod}
              setSelectedMonth={setSelectedMonth}
              exportWord={exportWord}
              isExporting={isExporting}
              reportDataLength={reportDataLength}
            />
          )}

          <CourseClosingApprovalPanel profile={profile} classData={classData} {...courseClosing} />

          <ClassStudentsTab
            students={students}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            evaluations={filteredClassEvaluations}
            onEditEval={handleEditEval}
            onDeleteEval={handleDeleteEval}
            onOpenEvalSelect={handleOpenEvalSelect}
            classData={classData}
            isArchived={isArchived}
            isPaused={isPaused}
            canManageEvaluations={!isOffice}
            onSendZaloEvaluation={handleSendZaloFromCard}
            isSendingZalo={isSendingZalo}
            lockedEvaluationIds={courseClosing.snapshot?.lockedEvaluationIds || []}
          />
        </>
      ) : activeTab === 'attendance' &&
        (profile?.role === 'teacher' || profile?.role === 'admin' || profile?.role === 'office') ? (
        <ClassAttendanceTab
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          attendanceData={attendanceData}
          students={attendanceStudents || students}
          classDates={classDates}
          onAttendanceToggle={handleAttendanceToggle}
          onMarkAllPresent={handleMarkAllPresent}
          onMarkAllPresentError={handleMarkAllPresentError}
          onOpenDetail={setSelectedAttendanceForDetail}
          onNotifyAbsence={setNotifyAbsenceDate}
          onExportReport={exportAttendanceReport}
          onDeleteDates={handleDeleteDates}
          daysOfWeek={classData.daysOfWeek}
          classSessions={classSessions}
          onConfirmSession={handleConfirmSession}
          isArchived={isArchived}
          isPaused={isPaused}
          isAttendanceWritePending={isTogglingAttendance}
          isAttendancePending={isAttendancePending}
          confirmingSessionDate={confirmingSessionDate}
          isExportingReport={isExporting}
          onOpenStudent={onOpenAttendanceStudent}
          selectedStudentId={selectedAttendanceStudentId}
          onSelectedStudentHidden={onSelectedAttendanceStudentHidden}
          termScope={termScope}
          onAttendanceOverrideRequested={onAttendanceOverrideRequested}
        />
      ) : null}
    </>
  );
}
