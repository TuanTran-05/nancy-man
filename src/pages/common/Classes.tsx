import React, { useState, useEffect } from 'react';
import { Link } from 'react-router';
import {
  Plus,
  BookOpen,
  Calendar,
  Filter,
  ArrowRight,
  Clock,
  ArrowLeftRight,
  Trash2,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { cn, formatVN, getVNTodayStr } from '../../lib/core/utils';
import { generateNextClassId } from '../../lib/ids/idGenerator';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { Class, ClassStatus } from '../../types';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import {
  sortClassesByStatusGradeName,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import { suggestEndDate } from '../../lib/classes/courseDateUtils';
import { ModalPortal } from '../../components/common/ModalPortal';
import { useClassesData } from './hooks/useClassesData';
import { getClassSessionForDate } from '../../../shared/classSchedule';
import { ClassCard } from './components/ClassCard';
import { ClassFormModal } from './components/ClassFormModal';
import { ClassToolsModal } from './components/ClassToolsModal';
import { useMotionSafe } from '../../hooks/useMotionSafe';
import { Magnetic } from '../../components/common/Magnetic';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

function ClassesLoadingSkeleton({ message }: { message: string }) {
  return (
    <div className="space-y-8" aria-busy="true">
      <div>
        <div className="h-8 w-56 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/70" />
      </div>
      <div
        role="status"
        className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{message}</span>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-border-default bg-surface p-6 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-5 w-2/3 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-1/2 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/70" />
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <div className="h-3 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/70" />
              <div className="h-3 w-5/6 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/70" />
              <div className="h-9 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Classes() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { shouldReduceMotion } = useMotionSafe();
  const t = translations[language].classes;
  const isAdmin = profile?.role === 'admin';
  const isOffice = profile?.role === 'office';
  const hasFullAcademicAccess = isAdmin || isOffice;
  const canManageClassFinance = isAdmin || isOffice;

  const data = useClassesData(profile);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [classToDelete, setClassToDelete] = useState<string | null>(null);
  const [isToolsModalOpen, setIsToolsModalOpen] = useState(false);
  const [selectedClassForTools, setSelectedClassForTools] = useState<Class | null>(null);
  const [editingClass, setEditingClass] = useState<Class | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClassStatus | 'all' | 'ended'>('all');
  const [teacherFilter, setTeacherFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  const emptyWeeklySession = { dayOfWeek: 1, startTime: '', endTime: '', room: '' };

  const [formData, setFormData] = useState({
    name: '',
    schedule: '',
    daysOfWeek: [] as number[],
    description: '',
    startDate: '',
    endDate: '',
    startTime: '',
    room: '',
    teacherId: '',
    status: 'active' as ClassStatus,
    salaryPerSession: 0,
    tuitionFee: 0,
    grade: '' as string,
    weeklySessions: [{ ...emptyWeeklySession }] as any[],
  });

  const [importSourceClassId, setImportSourceClassId] = useState('');

  const selectedGrade = formData.grade ? Number(formData.grade) : null;
  const currentTeacherId = hasFullAcademicAccess
    ? formData.teacherId
    : editingClass?.teacherId || profile?.uid;

  const classTeacherLookup = hasFullAcademicAccess
    ? data.teachers
    : profile?.uid
      ? [{ uid: profile.uid, displayName: profile.displayName || 'GV' }]
      : [];

  const sourceClasses =
    selectedGrade && selectedGrade > 1 && currentTeacherId
      ? sortClassesByTeacherThenName(
          data.classes.filter(
            (c) =>
              c.teacherId === currentTeacherId &&
              c.grade === selectedGrade - 1 &&
              c.id !== editingClass?.id
          ),
          classTeacherLookup
        )
      : [];
  const formScheduleDays = React.useMemo(() => {
    const weeklySessionDays = Array.isArray(formData.weeklySessions)
      ? formData.weeklySessions
          .map((session: any) => Number(session.dayOfWeek))
          .filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [];
    const uniqueWeeklyDays = [...new Set(weeklySessionDays)].sort((a, b) => a - b);
    return uniqueWeeklyDays.length > 0 ? uniqueWeeklyDays : formData.daysOfWeek;
  }, [formData.daysOfWeek, formData.weeklySessions]);

  // Auto-calculate endDate when startDate, schedule, or grade changes
  useEffect(() => {
    if (editingClass) return;
    if (!formData.startDate) return;

    const endDate = suggestEndDate({
      startDate: formData.startDate,
      grade: formData.grade ? Number(formData.grade) : undefined,
      daysOfWeek: formScheduleDays,
      holidays: data.systemHolidays,
    });
    setFormData((prev) => (prev.endDate === endDate ? prev : { ...prev, endDate }));
  }, [formData.startDate, formData.grade, formScheduleDays, editingClass, data.systemHolidays]);

  useBodyScrollLock(isModalOpen || isDeleteModalOpen || isToolsModalOpen);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await data.handleSaveClass(editingClass, formData, importSourceClassId, t);
    if (success) {
      setIsModalOpen(false);
      setEditingClass(null);
      setImportSourceClassId('');
      setFormData({
        name: '',
        schedule: '',
        daysOfWeek: [],
        description: '',
        startDate: '',
        endDate: '',
        startTime: '',
        room: '',
        teacherId: '',
        status: 'active',
        salaryPerSession: 0,
        tuitionFee: 0,
        grade: '',
        weeklySessions: [{ ...emptyWeeklySession }],
      });
    }
  };

  const handleDelete = async () => {
    if (!classToDelete) return;
    const success = await data.handleDelete(
      classToDelete,
      translations[language].classesPage.deleteSuccess,
      t.saveError || translations[language].classesPage.deleteError
    );
    if (success) {
      setIsDeleteModalOpen(false);
      setClassToDelete(null);
    }
  };

  const confirmDelete = (id: string) => {
    setClassToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const openTools = (cls: Class) => {
    setSelectedClassForTools(cls);
    setIsToolsModalOpen(true);
  };

  const now = new Date();
  const isClassEnded = (cls: Class) =>
    cls.status === 'active' &&
    Boolean(cls.endDate) &&
    new Date(`${cls.endDate}T23:59:59`).getTime() < now.getTime();

  const filteredClasses = sortClassesByStatusGradeName(
    data.classes.filter((cls) => {
      if (statusFilter === 'ended') {
        if (!isClassEnded(cls)) return false;
      } else if (statusFilter !== 'all' && cls.status !== statusFilter) {
        return false;
      }
      if (teacherFilter !== 'all' && cls.teacherId !== teacherFilter) return false;
      if (gradeFilter !== 'all' && String(cls.grade || '') !== gradeFilter) return false;
      return true;
    }),
    {
      getStatus: (cls) => (isClassEnded(cls) ? 'archived' : cls.status),
    }
  );

  const availableGrades = Array.from(
    new Set(data.classes.map((c) => c.grade).filter(Boolean))
  ).sort((a, b) => Number(a) - Number(b));

  if (data.loading) {
    return <ClassesLoadingSkeleton message={t.loadingClasses} />;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-heading">{t.manageClasses}</h1>
          <p className="text-muted">{hasFullAcademicAccess ? t.adminDesc : t.teacherDesc}</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex bg-surface border border-border-default rounded-xl p-1 shadow-sm dark:shadow-black/20">
            {(['all', 'active', 'paused', 'archived', 'ended'] as const).map((s) => {
              const endedCount = data.classes.filter(isClassEnded).length;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize',
                    statusFilter === s
                      ? s === 'ended'
                        ? 'bg-red-600 text-white shadow-md dark:shadow-black/20 shadow-red-100'
                        : 'bg-blue-600 text-white shadow-md dark:shadow-black/20 shadow-blue-100'
                      : 'text-muted hover:bg-hover'
                  )}
                >
                  {s === 'all'
                    ? t.filterAll
                    : s === 'active'
                      ? t.filterActive
                      : s === 'paused'
                        ? t.filterPaused
                        : s === 'ended'
                          ? `${t.courseEnded}${endedCount > 0 ? ` (${endedCount})` : ''}`
                          : t.filterArchived}
                </button>
              );
            })}
          </div>
          {hasFullAcademicAccess && (
            <button
              onClick={() => {
                setEditingClass(null);
                const newClassName = generateNextClassId(
                  data.classes.map((c) => c.name),
                  'E'
                );
                setFormData({
                  name: newClassName,
                  schedule: '',
                  daysOfWeek: [],
                  description: '',
                  startDate: '',
                  endDate: '',
                  startTime: '',
                  room: '',
                  teacherId: '',
                  status: 'active',
                  salaryPerSession: 0,
                  tuitionFee: 0,
                  grade: '',
                  weeklySessions: [{ ...emptyWeeklySession }],
                });
                setImportSourceClassId('');
                setIsModalOpen(true);
              }}
              className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addClass}</span>
            </button>
          )}
        </div>
      </div>

      {data.loadingDetails && (
        <div
          role="status"
          data-testid="class-details-loading"
          className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t.loadingDetails}</span>
        </div>
      )}

      {/* Teacher & Grade Filters */}
      {hasFullAcademicAccess && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-subtle" />
            <span className="text-xs font-bold text-subtle uppercase tracking-wider">
              {t.filterLabel}:
            </span>
          </div>
          <div className="relative">
            <select
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              disabled={data.teacherReferencesLoading}
              className={cn(
                'pl-3 pr-8 py-2 bg-surface border rounded-xl text-sm font-medium outline-none appearance-none cursor-pointer transition-colors disabled:cursor-wait disabled:opacity-60',
                teacherFilter !== 'all'
                  ? 'border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30'
                  : 'border-border-default text-muted hover:border-slate-300'
              )}
            >
              <option value="all">
                {data.teacherReferencesLoading
                  ? t.loadingTeachers
                  : translations[language].classesPage.allTeachers}
              </option>
              {data.teachers.map((teacher) => (
                <option key={teacher.uid} value={teacher.uid}>
                  {teacher.displayName}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <svg
                className="w-4 h-4 text-subtle"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
          <div className="relative">
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className={cn(
                'pl-3 pr-8 py-2 bg-surface border rounded-xl text-sm font-medium outline-none appearance-none cursor-pointer transition-colors',
                gradeFilter !== 'all'
                  ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                  : 'border-border-default text-muted hover:border-slate-300'
              )}
            >
              <option value="all">{translations[language].classesPage.allGrades}</option>
              {availableGrades.map((g) => (
                <option key={g} value={String(g)}>
                  {t.gradeOption.replace('{grade}', String(g))}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <svg
                className="w-4 h-4 text-subtle"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
          {(teacherFilter !== 'all' || gradeFilter !== 'all') && (
            <button
              onClick={() => {
                setTeacherFilter('all');
                setGradeFilter('all');
              }}
              className="text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-2 rounded-xl transition-colors"
            >
              {translations[language].classesPage.clearFilters}
            </button>
          )}
          <span className="text-xs text-subtle font-medium">
            {filteredClasses.length}/{data.classes.length}{' '}
            {translations[language].classesPage.classes}
          </span>
        </div>
      )}

      {/* Substitute classes for today */}
      {!isAdmin && data.substituteClasses.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-blue-700 dark:text-blue-300 mb-4 flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5" />
            {t.substituteClasses}
          </h2>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8"
          >
            {data.substituteClasses.map((cls) => {
              const subSession = getClassSessionForDate(cls, cls._substituteRequest.date);
              const subTime = subSession?.startTime || cls.startTime;
              const subRoom = subSession?.room || cls.room;
              return (
                <motion.div
                  key={cls.id + '-sub'}
                  layout
                  variants={itemVariants}
                  whileHover={{
                    y: -5,
                    scale: 1.015,
                    boxShadow: '0 20px 40px rgba(59, 130, 246, 0.08)',
                    transition: { type: 'spring', stiffness: 450, damping: 24 },
                  }}
                  className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200 dark:border-blue-700/50 shadow-sm p-6 relative group transition-colors duration-200 cursor-default"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <Link
                        to={`/classes/${cls.id}`}
                        className="p-3 rounded-xl bg-blue-100 dark:bg-blue-500/20 text-blue-600 transition-colors"
                      >
                        <BookOpen className="w-6 h-6" />
                      </Link>
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-block bg-blue-100 text-blue-700 dark:text-blue-300">
                          {t.substituteBadge}
                        </div>
                      </div>
                    </div>
                  </div>
                  <Link to={`/classes/${cls.id}`} className="block group/title">
                    <h3 className="text-lg font-bold text-blue-800 dark:text-blue-200 mb-1 group-hover/title:text-blue-600 transition-colors flex items-center">
                      {cls.name}
                      <ArrowRight className="w-4 h-4 ml-2 opacity-0 -translate-x-2 group-hover/title:opacity-100 group-hover/title:translate-x-0 transition-all" />
                    </h3>
                  </Link>
                  <p className="text-blue-600 dark:text-blue-400 text-sm mb-3">
                    {t.substituteDesc.replace(
                      '{teacherName}',
                      cls._substituteRequest.requestingTeacherName
                    )}
                  </p>
                  <div className="flex flex-col space-y-1 mb-3">
                    <div className="flex items-center text-blue-600 dark:text-blue-400 text-xs">
                      <Calendar className="w-3 h-3 mr-2" />
                      <span>{cls._substituteRequest.date}</span>
                    </div>
                    {subTime && (
                      <div className="flex items-center text-blue-600 dark:text-blue-400 text-xs">
                        <Clock className="w-3 h-3 mr-2" />
                        <span className="font-bold">{subTime}</span>
                      </div>
                    )}
                    {subRoom && (
                      <div className="flex items-center text-blue-600 dark:text-blue-400 text-xs">
                        <span className="w-3 h-3 mr-2 flex items-center justify-center">📍</span>
                        <span>{subRoom}</span>
                      </div>
                    )}
                  </div>
                  <Link
                    to={`/classes/${cls.id}`}
                    className="block w-full text-center px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 text-sm"
                  >
                    {t.takeAttendance}
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      )}

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {filteredClasses.map((cls) => (
          <ClassCard
            key={cls.id}
            cls={cls}
            t={t}
            translations={translations}
            language={language}
            hasFullAcademicAccess={hasFullAcademicAccess}
            canManageClassFinance={canManageClassFinance}
            teachers={data.teachers}
            studentCounts={data.studentCounts}
            changingStatusClassId={data.changingStatusClassId}
            isClassEnded={isClassEnded}
            handleQuickStatusChange={(c, s) => data.handleQuickStatusChange(c, s, t)}
            openTools={openTools}
            setEditingClass={setEditingClass}
            setFormData={setFormData}
            setImportSourceClassId={setImportSourceClassId}
            setIsModalOpen={setIsModalOpen}
            confirmDelete={confirmDelete}
          />
        ))}
        {filteredClasses.length === 0 && (
          <div className="col-span-full py-20 text-center bg-surface rounded-2xl border-2 border-dashed border-border-default">
            <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-muted font-medium">{t.noClasses}</p>
          </div>
        )}
      </motion.div>

      {/* Class Creation/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <ClassFormModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            editingClass={editingClass}
            formData={formData}
            setFormData={setFormData}
            teachers={data.teachers}
            sourceClasses={sourceClasses}
            importSourceClassId={importSourceClassId}
            setImportSourceClassId={setImportSourceClassId}
            hasFullAcademicAccess={hasFullAcademicAccess}
            canManageClassFinance={canManageClassFinance}
            classTeacherLookup={classTeacherLookup}
            isSaving={data.isSaving}
            isImporting={data.isImporting}
            language={language}
            t={t}
            translations={translations}
            handleSubmit={handleSubmit}
          />
        )}
      </AnimatePresence>

      {/* Tools Modal */}
      <AnimatePresence>
        {isToolsModalOpen && selectedClassForTools && (
          <ClassToolsModal
            isOpen={isToolsModalOpen}
            onClose={() => setIsToolsModalOpen(false)}
            classData={selectedClassForTools}
            isAdmin={isAdmin}
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteModalOpen && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
              />
              <motion.div
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 380, damping: 26 }
                }
                className="relative bg-surface dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700/50 w-full max-w-sm p-6 text-center z-10"
              >
                <div className="w-16 h-16 bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                  {t.deleteTitle}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{t.deleteDesc}</p>
                <div className="flex gap-3 justify-end items-center">
                  <Magnetic>
                    <button
                      onClick={() => setIsDeleteModalOpen(false)}
                      className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors flex-1 w-full shadow-sm"
                    >
                      {translations[language].common.cancel}
                    </button>
                  </Magnetic>
                  <Magnetic>
                    <button
                      onClick={handleDelete}
                      disabled={data.isDeleting}
                      className="px-4 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 flex-1 w-full"
                    >
                      {data.isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                      {data.isDeleting ? t.deletingBtn : t.deleteBtn}
                    </button>
                  </Magnetic>
                </div>
              </motion.div>
            </div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}
