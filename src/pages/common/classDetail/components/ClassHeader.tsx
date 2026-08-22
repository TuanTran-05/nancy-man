import { Link } from 'react-router';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Clock,
  ClipboardCheck,
  DollarSign,
  Plus,
  Scan,
  Users,
} from 'lucide-react';

import type { Class } from '../../../../types';
import { cn, formatVN } from '../../../../lib/core/utils';
import { formatVndAmount } from '../../../../lib/core/moneyFormat';
import { useLanguage } from '../../../../lib/i18n/useLanguage';
import { formatWeeklyClassSchedule } from '../../../../../shared/classSchedule';

type ClassHeaderProps = {
  classData: Class;
  studentCount: number;
  isOnline: boolean;
  isAdmin: boolean;
  canAddStudent: boolean;
  canManageClass: boolean;
  canUseTeachingTools: boolean;
  isArchived: boolean;
  isPaused: boolean;
  todayStr: string;
  onOpenResetCourse: () => void;
  onOpenFaceAttendance: () => void;
  onOpenDailyReport: (targetDate: string) => void;
  onAddStudent: () => void;
};

export function ClassHeader({
  classData,
  studentCount,
  isOnline,
  isAdmin,
  canAddStudent,
  canManageClass,
  canUseTeachingTools,
  isArchived,
  isPaused,
  todayStr,
  onOpenResetCourse,
  onOpenFaceAttendance,
  onOpenDailyReport,
  onAddStudent,
}: ClassHeaderProps) {
  const { t, language } = useLanguage();
  const dayLabels =
    language === 'vi'
      ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <>
      {/* Header */}
      {!isOnline && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 px-4 py-2 flex items-center justify-center space-x-2 animate-pulse sticky top-0 z-[60]">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <span className="text-amber-800 text-sm font-medium">{t.classDetail.offlineWarning}</span>
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link
            to="/classes"
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-heading">{classData.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 mt-1">
              <div className="flex items-center">
                <Calendar className="w-4 h-4 mr-1.5" />
                <span>
                  {formatVN(classData.startDate, 'dd/MM/yyyy')} -{' '}
                  {formatVN(classData.endDate, 'dd/MM/yyyy')}
                </span>
              </div>
              <div className="flex items-center">
                <Clock className="w-4 h-4 mr-1.5" />
                <span>{formatWeeklyClassSchedule(classData, dayLabels)}</span>
              </div>
              <div className="flex items-center">
                <Users className="w-4 h-4 mr-1.5" />
                <span>{t.classDetail.studentCount.replace('{count}', String(studentCount))}</span>
              </div>
              {isAdmin && classData.salaryPerSession != null && classData.salaryPerSession > 0 && (
                <div className="flex items-center text-emerald-600">
                  <DollarSign className="w-4 h-4 mr-1.5" />
                  <span className="font-bold">
                    {t.classDetail.salaryPerSession.replace(
                      '{salary}',
                      formatVndAmount(classData.salaryPerSession)
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {canManageClass && !isArchived && (
            <button
              onClick={onOpenResetCourse}
              className="flex items-center space-x-2 bg-surface border border-border-default text-slate-600 px-4 py-2 rounded-lg font-medium hover:bg-hover transition-colors shadow-sm dark:shadow-black/20"
            >
              <Clock className="w-4 h-4" />
              <span>{t.classDetail.resetCourse}</span>
            </button>
          )}
          {canUseTeachingTools && (
            <>
              <button
                onClick={onOpenFaceAttendance}
                disabled={isPaused || isArchived}
                className={cn(
                  'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors shadow-lg',
                  isPaused || isArchived
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-100'
                )}
              >
                <Scan className="w-4 h-4" />
                <span>{t.classDetail.headerFaceAttendance}</span>
              </button>
              <button
                onClick={() => onOpenDailyReport(todayStr)}
                disabled={isArchived}
                className={cn(
                  'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors shadow-lg',
                  isArchived
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100'
                )}
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>{t.classDetail.headerDailyReport}</span>
              </button>
            </>
          )}
          {canAddStudent && !isArchived && (
            <button
              onClick={onAddStudent}
              className="flex items-center space-x-2 bg-surface border border-border-default text-slate-600 px-4 py-2 rounded-lg font-medium hover:bg-hover transition-colors shadow-sm dark:shadow-black/20"
            >
              <Plus className="w-4 h-4" />
              <span>{t.classDetail.addStudent}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
