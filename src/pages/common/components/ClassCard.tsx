import React from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  Play,
  Pause,
  Edit2,
  Trash2,
  Calendar,
  Clock,
  DollarSign,
  BookOpen,
  ArrowRight,
  Wand2,
  Loader2,
} from 'lucide-react';
import { cn, formatVN } from '../../../lib/core/utils';
import { formatVndAmount } from '../../../lib/core/moneyFormat';
import { Class } from '../../../types';
import { ClassStudentCount } from '../../../lib/student/classStudentCounts';
import {
  formatWeeklyClassSchedule,
  getWeeklyClassSessions,
} from '../../../../shared/classSchedule';

interface ClassCardProps {
  cls: Class;
  t: any;
  translations: any;
  language: string;
  hasFullAcademicAccess: boolean;
  canManageClassFinance: boolean;
  teachers: Array<{ uid: string; displayName: string; email: string }>;
  studentCounts: Record<string, ClassStudentCount>;
  changingStatusClassId: string | null;
  isClassEnded: (cls: Class) => boolean;
  handleQuickStatusChange: (cls: Class, newStatus: 'active' | 'paused' | 'archived') => void;
  openTools: (cls: Class) => void;
  setEditingClass: (cls: Class) => void;
  setFormData: (data: any) => void;
  setImportSourceClassId: (id: string) => void;
  setIsModalOpen: (open: boolean) => void;
  confirmDelete: (id: string) => void;
}

export function ClassCard({
  cls,
  t,
  translations,
  language,
  hasFullAcademicAccess,
  canManageClassFinance,
  teachers,
  studentCounts,
  changingStatusClassId,
  isClassEnded,
  handleQuickStatusChange,
  openTools,
  setEditingClass,
  setFormData,
  setImportSourceClassId,
  setIsModalOpen,
  confirmDelete,
}: ClassCardProps) {
  const isEnded = isClassEnded(cls);
  const teacherProfile = teachers.find((tc) => tc.uid === cls.teacherId);

  const itemVariants = {
    hidden: { opacity: 0, y: 25 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring' as const, stiffness: 350, damping: 25 },
    },
  };

  return (
    <motion.div
      variants={itemVariants}
      whileHover={{
        y: -5,
        scale: 1.015,
        boxShadow:
          cls.status === 'paused'
            ? '0 20px 40px rgba(245, 158, 11, 0.08)'
            : isEnded
              ? '0 20px 40px rgba(239, 68, 68, 0.08)'
              : '0 20px 40px rgba(59, 130, 246, 0.08)',
        transition: { type: 'spring', stiffness: 450, damping: 24 },
      }}
      className={cn(
        'bg-surface dark:bg-slate-800 rounded-2xl border shadow-sm dark:shadow-black/20 p-6 relative group transition-colors duration-200 cursor-default border-border-default dark:border-slate-700/50',
        cls.status === 'paused'
          ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10'
          : cls.status === 'archived'
            ? 'border-border-default dark:border-slate-800 bg-page/50 opacity-75'
            : isEnded
              ? 'border-red-200 dark:border-red-500/30 bg-red-50/30 dark:bg-red-500/5'
              : 'border-border-default'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <Link
            to={`/classes/${cls.id}`}
            className={cn(
              'p-3 rounded-xl transition-colors',
              cls.status === 'paused'
                ? 'bg-amber-100 text-amber-600'
                : cls.status === 'archived'
                  ? 'bg-slate-200 text-slate-600'
                  : 'bg-blue-50 dark:bg-blue-500/10 text-blue-600'
            )}
          >
            <BookOpen className="w-6 h-6" />
          </Link>
          <div>
            <div
              className={cn(
                'text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-block',
                cls.status === 'active'
                  ? 'bg-emerald-100 text-emerald-700 dark:text-emerald-400'
                  : cls.status === 'paused'
                    ? 'bg-amber-100 text-amber-700 dark:text-amber-400'
                    : 'bg-slate-200 text-slate-700'
              )}
            >
              {cls.status === 'active'
                ? t.filterActive
                : cls.status === 'paused'
                  ? t.filterPaused
                  : t.filterArchived}
            </div>
            {isEnded && (
              <div className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-block mt-1 bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 animate-pulse">
                {t.courseEnded}
              </div>
            )}
          </div>
        </div>
        <div className="flex space-x-1">
          {hasFullAcademicAccess && cls.status !== 'archived' && (
            <>
              {changingStatusClassId === cls.id ? (
                <div className="p-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                </div>
              ) : cls.status === 'active' ? (
                <button
                  onClick={() => handleQuickStatusChange(cls, 'paused')}
                  disabled={changingStatusClassId !== null}
                  className="p-2 text-amber-500 hover:bg-amber-50 dark:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
                  title={t.pauseClass}
                >
                  <Pause className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => handleQuickStatusChange(cls, 'active')}
                  disabled={changingStatusClassId !== null}
                  className="p-2 text-emerald-500 hover:bg-emerald-50 dark:bg-emerald-500/10 rounded-lg transition-colors disabled:opacity-50"
                  title={t.resumeClass}
                >
                  <Play className="w-4 h-4" />
                </button>
              )}
            </>
          )}

          <button
            onClick={() => openTools(cls)}
            className="p-2 text-subtle hover:text-emerald-600 hover:bg-emerald-50 dark:bg-emerald-500/10 rounded-lg transition-colors"
            title={t.classTools}
          >
            <Wand2 className="w-4 h-4" />
          </button>
          {hasFullAcademicAccess && (
            <button
              onClick={() => {
                setEditingClass(cls);
                setFormData({
                  name: cls.name,
                  schedule: cls.schedule,
                  daysOfWeek: cls.daysOfWeek || [],
                  description: cls.description || '',
                  startDate: cls.startDate || '',
                  endDate: cls.endDate || '',
                  startTime: cls.startTime || '',
                  room: cls.room || '',
                  teacherId: cls.teacherId || '',
                  status: cls.status || 'active',
                  salaryPerSession: Number(cls.salaryPerSession || 0),
                  tuitionFee: Number(cls.tuitionFee || 0),
                  grade: String(cls.grade || ''),
                  weeklySessions:
                    cls.weeklySessions && cls.weeklySessions.length > 0
                      ? cls.weeklySessions
                      : getWeeklyClassSessions(cls).map((session) => ({
                          dayOfWeek: session.dayOfWeek,
                          startTime: session.startTime,
                          endTime: session.endTime,
                          room: session.room || '',
                        })),
                });
                setImportSourceClassId('');
                setIsModalOpen(true);
              }}
              className="p-2 text-subtle hover:text-blue-600 hover:bg-blue-50 dark:bg-blue-500/10 rounded-lg transition-colors"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
          {hasFullAcademicAccess && (
            <button
              onClick={() => confirmDelete(cls.id)}
              className="p-2 text-subtle hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <Link to={`/classes/${cls.id}`} className="block group/title">
        <h3 className="text-lg font-bold text-heading mb-1 group-hover/title:text-blue-600 transition-colors flex items-center">
          {cls.name}
          <ArrowRight className="w-4 h-4 ml-2 opacity-0 -translate-x-2 group-hover/title:opacity-100 group-hover/title:translate-x-0 transition-all" />
        </h3>
      </Link>

      {hasFullAcademicAccess && (
        <div className="flex items-center space-x-2 mb-3 px-3 py-1.5 bg-page rounded-lg border border-border-light">
          <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px] font-bold">
            {teacherProfile?.displayName?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-subtle uppercase font-black leading-none">{t.teacher}</p>
            <p className="text-xs font-bold text-slate-700 truncate">
              {teacherProfile?.displayName || t.unassigned}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col space-y-1 mb-3">
        <div className="flex items-center text-muted text-xs">
          <Calendar className="w-3 h-3 mr-2" />
          <span>
            {cls.startDate ? formatVN(cls.startDate, 'dd/MM/yyyy') : 'N/A'} -{' '}
            {cls.endDate ? formatVN(cls.endDate, 'dd/MM/yyyy') : 'N/A'}
          </span>
        </div>
        <div className="flex items-center text-muted text-xs">
          <Clock className="w-3 h-3 mr-2" />
          <span>{formatWeeklyClassSchedule(cls, t.days)}</span>
        </div>
        {cls.room && (
          <div className="flex items-center text-muted text-xs">
            <span className="w-3 h-3 mr-2 flex items-center justify-center">📍</span>
            <span>{cls.room}</span>
          </div>
        )}
        {canManageClassFinance && cls.salaryPerSession != null && cls.salaryPerSession > 0 && (
          <div className="flex items-center text-emerald-600 text-xs">
            <span className="w-3 h-3 mr-2 flex items-center justify-center">
              <DollarSign className="w-3 h-3" />
            </span>
            <span className="font-bold">
              {formatVndAmount(cls.salaryPerSession)} {t.currencySymbol}/
              {translations[language].payroll.sessions}
            </span>
          </div>
        )}
        {canManageClassFinance && cls.tuitionFee ? (
          <div className="flex items-center text-blue-600 text-xs">
            <span className="w-3 h-3 mr-2 flex items-center justify-center">
              <DollarSign className="w-3 h-3" />
            </span>
            <span className="font-bold">
              {formatVndAmount(cls.tuitionFee)} {t.currencyPerCourse}
            </span>
          </div>
        ) : null}
      </div>

      {/* Student Counts Summary */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        <div className="bg-page p-2 rounded-xl border border-border-light text-center">
          <p className="text-[10px] font-black text-subtle uppercase leading-none mb-1">
            {t.total}
          </p>
          <p className="text-sm font-bold text-heading">{studentCounts[cls.id]?.total || 0}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-500/10 p-2 rounded-xl border border-emerald-100 text-center">
          <p className="text-[10px] font-black text-emerald-400 uppercase leading-none mb-1">
            {t.learning}
          </p>
          <p className="text-sm font-bold text-emerald-600">{studentCounts[cls.id]?.active || 0}</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/10 p-2 rounded-xl border border-amber-100 text-center">
          <p className="text-[10px] font-black text-amber-500 uppercase leading-none mb-1">Trial</p>
          <p className="text-sm font-bold text-amber-600">{studentCounts[cls.id]?.trial || 0}</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/10 p-2 rounded-xl border border-amber-100 text-center">
          <p className="text-[10px] font-black text-amber-400 uppercase leading-none mb-1">
            {t.onLeave}
          </p>
          <p className="text-sm font-bold text-amber-600">{studentCounts[cls.id]?.onLeave || 0}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-500/10 p-2 rounded-xl border border-red-100 text-center">
          <p className="text-[10px] font-black text-red-400 uppercase leading-none mb-1">
            {t.dropped}
          </p>
          <p className="text-sm font-bold text-red-600">{studentCounts[cls.id]?.dropped || 0}</p>
        </div>
      </div>

      <p className="text-slate-600 dark:text-slate-350 text-sm line-clamp-2">{cls.description}</p>
    </motion.div>
  );
}
