import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Settings, ShieldCheck, LayoutDashboard, Users } from 'lucide-react';
import { cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { CreateStaffModal } from '../../components/students/CreateStaffModal';
import { useAuth } from '../../contexts/AuthContext';
import { AdminOverviewTab } from './AdminOverviewTab';
import { StaffProfileModal } from '../../components/admin/StaffProfileModal';
import { useAdminDashboardData } from './hooks/useAdminDashboardData';
import { useOfficeSettingsData } from './hooks/useOfficeSettingsData';
import { StaffTab } from './tabs/StaffTab';
import { SettingsTab } from './tabs/SettingsTab';
import { AuditTab } from './tabs/AuditTab';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = translations[language].adminDashboard;
  const ap = translations[language].adminPage;
  const isAdmin = profile?.role === 'admin';
  const identity = { uid: profile?.uid || '', role: profile?.role || '' };

  const [activeTab, setActiveTab] = useState<'overview' | 'staff' | 'settings' | 'audit'>(
    isAdmin ? 'overview' : 'settings'
  );

  const [showCreateStaffModal, setShowCreateStaffModal] = useState(false);

  const data = useAdminDashboardData(isAdmin, language);
  const officeSettings = useOfficeSettingsData(identity, language);

  const closeStaffModal = () => {
    setShowCreateStaffModal(false);
  };

  const userName = profile?.displayName || ap.admin;

  if (isAdmin ? data.loading : officeSettings.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard mx-auto w-full max-w-[1600px] space-y-5 pb-8 sm:space-y-6 sm:pb-10">
      <div>
        <div>
          <h1 className="max-w-full break-words text-2xl font-bold leading-tight text-slate-950 sm:text-3xl">
            {ap.welcomeBack} <span className="text-blue-600">{userName}</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{ap.todayOverview}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="-mx-1 flex w-[calc(100%+0.5rem)] gap-1 overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200/80 bg-white/80 p-1 shadow-sm sm:mx-0 sm:w-full sm:rounded-2xl lg:w-fit">
        {isAdmin && (
          <button
            onClick={() => setActiveTab('overview')}
            className={cn(
              'flex shrink-0 items-center whitespace-nowrap px-3 py-2 text-xs font-bold transition-all rounded-lg sm:rounded-xl sm:px-4 sm:text-sm',
              activeTab === 'overview'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <LayoutDashboard className="w-4 h-4 mr-2 shrink-0" />
            {t.tabs.overview}
          </button>
        )}

        {isAdmin && (
          <button
            onClick={() => setActiveTab('staff')}
            className={cn(
              'flex shrink-0 items-center whitespace-nowrap px-3 py-2 text-xs font-bold transition-all rounded-lg sm:rounded-xl sm:px-4 sm:text-sm',
              activeTab === 'staff'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <Users className="w-4 h-4 mr-2 shrink-0" />
            {t.tabs.teachers}
          </button>
        )}

        <button
          onClick={() => setActiveTab('settings')}
          className={cn(
            'flex shrink-0 items-center whitespace-nowrap px-3 py-2 text-xs font-bold transition-all rounded-lg sm:rounded-xl sm:px-4 sm:text-sm',
            activeTab === 'settings'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Settings className="w-4 h-4 mr-2 shrink-0" />
          {t.tabs.settings}
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab('audit')}
            className={cn(
              'flex shrink-0 items-center whitespace-nowrap px-3 py-2 text-xs font-bold transition-all rounded-lg sm:rounded-xl sm:px-4 sm:text-sm',
              activeTab === 'audit'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <ShieldCheck className="w-4 h-4 mr-2 shrink-0" />
            {t.tabs.audit}
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {isAdmin && activeTab === 'overview' && (
          <AdminOverviewTab
            language={language}
            t={t}
            activeStudentsCount={data.activeStudentsCount}
            studentsCount={data.studentsCount}
            activeRate={data.activeRate}
            classSparkline={data.classSparkline}
            registeredTeachers={data.registeredTeachers}
            classes={data.classes}
            fundReport={data.fundReport}
            reportLoading={data.reportLoading}
            financeBalance={data.financeBalance}
            reportFrom={data.reportFrom}
            setReportFrom={data.setReportFrom}
            reportTo={data.reportTo}
            setReportTo={data.setReportTo}
            handleLoadFundReport={data.handleLoadFundReport}
            genderData={data.genderData}
            performanceRows={data.performanceRows}
            performanceTotal={data.performanceTotal}
            passCount={data.passCount}
            passRate={data.passRate}
            systemActivity={data.systemActivity}
            classStudentCounts={data.classStudentCounts}
          />
        )}

        {isAdmin && activeTab === 'staff' && (
          <StaffTab
            language={language}
            t={t}
            ap={ap}
            allowedTeachers={data.allowedTeachers}
            blockedTeachers={data.blockedTeachers}
            registeredStaff={data.registeredStaff}
            classes={data.classes}
            newEmail={data.newEmail}
            setNewEmail={data.setNewEmail}
            actionLoading={data.actionLoading}
            confirmDelete={data.confirmDelete}
            setShowCreateStaffModal={setShowCreateStaffModal}
            setSelectedStaffProfile={data.setSelectedStaffProfile}
            handleAddEmail={data.handleAddEmail}
            handleRemoveEmail={data.handleRemoveEmail}
            handleUnblockEmail={data.handleUnblockEmail}
            handleDeleteBlockedEmail={data.handleDeleteBlockedEmail}
            handleDeleteUserAccount={data.handleDeleteUserAccount}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            language={language}
            t={t}
            ap={ap}
            isAdmin={isAdmin}
            newHoliday={officeSettings.newHoliday}
            setNewHoliday={officeSettings.setNewHoliday}
            holidayActionLoading={officeSettings.holidayActionLoading}
            holidayDates={officeSettings.holidayDates}
            isExporting={data.isExporting}
            isStandardizing={data.isStandardizing}
            handleAddHoliday={officeSettings.handleAddHoliday}
            handleRemoveHoliday={officeSettings.handleRemoveHoliday}
            handleExportExcel={data.handleExportExcel}
            handleExportSQL={data.handleExportSQL}
            handleStandardizeStudentIds={data.handleStandardizeStudentIds}
            handleStandardizeTeacherIds={data.handleStandardizeTeacherIds}
          />
        )}

        {isAdmin && activeTab === 'audit' && (
          <AuditTab
            language={language}
            t={t}
            ap={ap}
            auditLogs={data.auditLogs}
            auditUserMap={data.auditUserMap}
            studentRecords={data.studentRecords}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {data.selectedStaffProfile && (
          <StaffProfileModal
            staff={data.selectedStaffProfile}
            assignedClasses={data.selectedStaffClasses}
            language={language}
            onClose={() => data.setSelectedStaffProfile(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateStaffModal && (
          <CreateStaffModal isOpen={showCreateStaffModal} onClose={closeStaffModal} />
        )}
      </AnimatePresence>
    </div>
  );
}
