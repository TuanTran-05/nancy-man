import React from 'react';
import { Search, Users, ClipboardCheck, Edit2, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Student, Evaluation, Class } from '../../types';
import { formatVN, cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { deriveStudentLifecycle } from '../../../shared/studentLifecycle';
import { selectEnrolledStudentRows } from '../../lib/student/currentRecords';

interface ClassStudentsTabProps {
  students: Student[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  evaluations: Evaluation[];
  onEditEval: (ev: Evaluation, student: Student) => void;
  onDeleteEval: (id: string) => void;
  onOpenEvalSelect: (
    student: Student,
    midtermEval: Evaluation | null,
    finalEval: Evaluation | null
  ) => void;
  classData: Class;
  isArchived?: boolean;
  isPaused?: boolean;
  canManageEvaluations?: boolean;
  onSendZaloEvaluation?: (student: Student, evaluation: Evaluation) => void;
  isSendingZalo?: boolean;
  lockedEvaluationIds?: string[];
}

export function getClassRosterEnrollmentStatus(student: Student) {
  return student.attendanceEnrollment?.status ?? student.enrollmentStatus ?? 'active';
}

export const ClassStudentsTab: React.FC<ClassStudentsTabProps> = ({
  students,
  searchTerm,
  setSearchTerm,
  evaluations,
  onEditEval,
  onDeleteEval,
  onOpenEvalSelect,
  classData,
  isArchived,
  isPaused,
  canManageEvaluations = true,
  lockedEvaluationIds = [],
}) => {
  const { t } = useLanguage();
  const isReadOnly = Boolean(isArchived || isPaused || !canManageEvaluations);

  const rosterStudents = React.useMemo(
    () => (isArchived || isPaused ? students : selectEnrolledStudentRows(students)),
    [isArchived, isPaused, students]
  );

  const filteredStudents = rosterStudents.filter(
    (s) =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.studentId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeStudents = filteredStudents.filter((student) => {
    const lifecycle = deriveStudentLifecycle(student);
    const enrollmentStatus = getClassRosterEnrollmentStatus(student);
    return lifecycle !== 'archived' && (lifecycle === 'trial' || enrollmentStatus === 'active');
  });
  const inactiveStudents = filteredStudents.filter((student) => {
    const lifecycle = deriveStudentLifecycle(student);
    const enrollmentStatus = getClassRosterEnrollmentStatus(student);
    return lifecycle === 'archived' || (lifecycle !== 'trial' && enrollmentStatus !== 'active');
  });

  const highlightMatch = (text: string, highlight: string) => {
    if (!highlight.trim()) return <>{text}</>;

    const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'));

    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} className="bg-yellow-200 text-slate-900 rounded-sm px-[1px]">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  const getStatusBadge = (student: Student) => {
    const lifecycle = deriveStudentLifecycle(student);
    if (lifecycle === 'trial') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
          Trial {student.trialSessionCount || 0}/{student.trialRequiredSessions || 2}
        </span>
      );
    }
    if (lifecycle === 'archived') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
          Archived
        </span>
      );
    }
    const currentStatus = getClassRosterEnrollmentStatus(student);
    if (currentStatus === 'active') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">
          {t.classStudentsTab.active}
        </span>
      );
    }
    if (currentStatus === 'on_leave') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
          {t.classStudentsTab.onLeave}
        </span>
      );
    }
    if (currentStatus === 'dropped') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
          {t.classStudentsTab.dropped}
        </span>
      );
    }
    if (currentStatus === 'promoted') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
          {t.classStudentsTab.promoted}
        </span>
      );
    }
    return null;
  };

  const renderEvaluationBlock = (evalData: Evaluation, title: string, student: Student) => {
    const isLocked = lockedEvaluationIds.includes(evalData.id);
    return (
      <div className="space-y-3 mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase">
            {title} ({formatVN(evalData.date, 'dd/MM/yyyy')})
          </span>
          {isLocked ? (
            <span
              title={t.classStudentsTab.evaluationLockedTooltip}
              className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700"
            >
              {t.classStudentsTab.evaluationLocked}
            </span>
          ) : !isReadOnly ? (
            <div className="flex items-center space-x-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditEval(evalData, student);
                }}
                className="p-1.5 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"
                title={t.classStudentsTab.editEval.replace('{title}', title)}
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEval(evalData.id);
                }}
                className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                title={t.classStudentsTab.deleteEval.replace('{title}', title)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-blue-600">
            {t.classStudentsTab.avgPrefix} {evalData.totalScore}%
          </span>
          {evalData.finalScore !== undefined && evalData.finalScore !== null && (
            <span className="text-sm font-bold text-emerald-600">
              {t.classStudentsTab.finalScore} {evalData.finalScore}
            </span>
          )}
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600" style={{ width: `${evalData.totalScore}%` }} />
        </div>
        <p className="text-xs text-slate-500 line-clamp-1 italic">
          "{evalData.positivePoints?.[0] || t.classStudentsTab.noComments}"
        </p>
      </div>
    );
  };

  const renderStudentCard = (student: Student) => {
    const enrollmentStatus = getClassRosterEnrollmentStatus(student);
    const studentEvals = evaluations.filter((ev) => ev.studentId === student.id);
    const midtermEval = studentEvals.find((ev) => ev.evaluationType === 'midterm');
    const finalEval = studentEvals.find((ev) => ev.evaluationType === 'final');

    // Fallback for older data without type
    let mEval = midtermEval;
    let fEval = finalEval;

    if (!midtermEval && !finalEval && studentEvals.length > 0) {
      const sorted = [...studentEvals].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      if (sorted.length >= 2) {
        mEval = sorted[0];
        fEval = sorted[sorted.length - 1];
      } else {
        fEval = sorted[0];
      }
    }

    return (
      <motion.div
        key={student.id}
        whileHover={!isReadOnly ? { y: -2 } : {}}
        onClick={() => !isReadOnly && onOpenEvalSelect(student, mEval || null, fEval || null)}
        className={cn(
          'bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all text-left group relative',
          !isReadOnly && 'cursor-pointer',
          (enrollmentStatus === 'on_leave' || isArchived) && 'opacity-75',
          (enrollmentStatus === 'dropped' || enrollmentStatus === 'promoted') &&
            'opacity-50 grayscale'
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div
              className={cn(
                'w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-bold text-lg transition-colors',
                !isReadOnly && 'group-hover:bg-blue-600 group-hover:text-white'
              )}
            >
              {student.name[0].toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">
                  {highlightMatch(student.name, searchTerm)}
                </h3>
                {getStatusBadge(student)}
              </div>
              <p className="text-xs text-slate-500">
                {highlightMatch(student.studentId, searchTerm)}
              </p>
            </div>
          </div>
          {!isReadOnly && (
            <div className="p-2 bg-slate-50 rounded-lg text-slate-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-colors">
              <ClipboardCheck className="w-5 h-5" />
            </div>
          )}
        </div>

        {mEval && renderEvaluationBlock(mEval, t.classStudentsTab.midterm, student)}
        {fEval && renderEvaluationBlock(fEval, t.classStudentsTab.final, student)}

        {!mEval && !fEval && (
          <div className="py-4 mt-4 text-center border-2 border-dashed border-slate-100 rounded-xl">
            <p className="text-xs text-slate-400">{t.classStudentsTab.noEval}</p>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">{t.classStudentsTab.studentList}</h2>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={t.classStudentsTab.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
        </div>
      </div>

      {activeStudents.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">
            {t.classStudentsTab.activeCount.replace('{count}', String(activeStudents.length))}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeStudents.map(renderStudentCard)}
          </div>
        </div>
      )}

      {inactiveStudents.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">
            {t.classStudentsTab.inactiveCount.replace('{count}', String(inactiveStudents.length))}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {inactiveStudents.map(renderStudentCard)}
          </div>
        </div>
      )}

      {filteredStudents.length === 0 && (
        <div className="col-span-full py-12 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-100">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500">{t.classStudentsTab.noStudentsInClass}</p>
        </div>
      )}
    </div>
  );
};
