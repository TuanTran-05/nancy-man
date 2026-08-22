import React, { useState, useMemo } from 'react';
import { Submission } from '../../types';
import { cn, formatVN } from '../../lib/core/utils';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  SortDesc,
  Search,
  FileText,
  CheckCircle,
  Clock,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { vi, enUS } from 'date-fns/locale';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import { localize } from '../../lib/i18n/localize';

interface SubmissionsListProps {
  submissions: Submission[];
  assignmentId: string;
  assignmentType: 'essay' | 'quiz';
  isAssessmentV2?: boolean;
  getStudentName: (id: string) => string;
  onGrade: (s: Submission) => void;
}

export function SubmissionsList({
  submissions,
  assignmentId,
  assignmentType,
  isAssessmentV2,
  getStudentName,
  onGrade,
}: SubmissionsListProps) {
  const { language, t } = useLanguage();
  const T = t.pageAssignments;
  const dateLocale = localize(language, vi, enUS);

  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [previewSub, setPreviewSub] = useState<Submission | null>(null);

  // Filters & Sort
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [statusFilter, setStatusFilter] = useState<'all' | 'graded' | 'ungraded'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const subs = useMemo(() => {
    return submissions
      .filter((s) => s.assignmentId === assignmentId)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [submissions, assignmentId]);

  // Group submissions by student
  const groupedSubs = useMemo(() => {
    const groups: Record<string, Submission[]> = {};
    subs.forEach((sub) => {
      if (!groups[sub.studentId]) groups[sub.studentId] = [];
      groups[sub.studentId].push(sub);
    });
    return groups;
  }, [subs]);

  // Filter and sort the grouped students
  const filteredStudents = useMemo(() => {
    let result = Object.keys(groupedSubs).map((studentId) => {
      const studentSubs = groupedSubs[studentId];
      const latestSub = studentSubs[0]; // Already sorted by desc from PostgreSQL API
      const studentName = getStudentName(studentId);

      const gradedSubs = studentSubs.filter((s) => s.status === 'graded' && s.grade !== undefined);
      const highestGrade =
        gradedSubs.length > 0 ? Math.max(...gradedSubs.map((s) => s.grade as number)) : undefined;

      return { studentId, studentName, studentSubs, latestSub, highestGrade };
    });

    // Search
    if (searchQuery) {
      result = result.filter((item) =>
        item.studentName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by status (based on latest submission)
    if (statusFilter === 'graded') {
      result = result.filter((item) => item.latestSub.status === 'graded');
    } else if (statusFilter === 'ungraded') {
      result = result.filter((item) => item.latestSub.status !== 'graded');
    }

    // Sort
    result.sort((a, b) => {
      const timeA = new Date(a.latestSub.submittedAt).getTime();
      const timeB = new Date(b.latestSub.submittedAt).getTime();
      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });

    return result;
  }, [groupedSubs, getStudentName, searchQuery, statusFilter, sortOrder]);

  const isNew = (dateString: string) => {
    const hoursDiff = (new Date().getTime() - new Date(dateString).getTime()) / (1000 * 60 * 60);
    return hoursDiff < 24; // Consider new if submitted within last 24 hours
  };

  if (subs.length === 0) return null;

  return (
    <div className="space-y-4 mt-4 border-t border-slate-100 pt-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-slate-800">
          {T.submissionCountLabel.replace('{count}', subs.length.toString())}
        </h4>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder={T.searchStudents}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none w-32 sm:w-40"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="all">{T.allStatuses}</option>
            <option value="ungraded">{T.ungraded}</option>
            <option value="graded">{T.graded}</option>
          </select>

          <button
            onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
            className="flex items-center gap-1 px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600"
          >
            <SortDesc
              className={cn(
                'w-3.5 h-3.5 transition-transform',
                sortOrder === 'oldest' && 'rotate-180'
              )}
            />
            {sortOrder === 'newest' ? T.newest : T.oldest}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {filteredStudents.map(
          ({ studentId, studentName, studentSubs, latestSub, highestGrade }) => (
            <div
              key={studentId}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div
                className={cn(
                  'flex items-center justify-between p-3 cursor-pointer transition-colors',
                  isNew(latestSub.submittedAt) && latestSub.status !== 'graded'
                    ? 'bg-indigo-50/50'
                    : 'hover:bg-slate-50'
                )}
                onClick={() => setExpandedStudent(expandedStudent === studentId ? null : studentId)}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                    {studentName[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-900">{studentName}</p>
                      {isNew(latestSub.submittedAt) && latestSub.status !== 'graded' && (
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[9px] font-bold rounded uppercase tracking-wider">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {T.submissionDetails
                        .replace('{count}', studentSubs.length.toString())
                        .replace(
                          '{time}',
                          formatDistanceToNow(new Date(latestSub.submittedAt), {
                            addSuffix: true,
                            locale: dateLocale,
                          })
                        )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full',
                      latestSub.status === 'graded'
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-amber-50 text-amber-600'
                    )}
                  >
                    {latestSub.status === 'graded' ? (
                      <>
                        <CheckCircle className="w-3 h-3" />
                        <span>
                          {T.gradedBadge.replace(
                            '{score}',
                            (highestGrade !== undefined ? highestGrade : latestSub.grade).toString()
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3" />
                        <span>{T.ungraded}</span>
                      </>
                    )}
                  </div>
                  {expandedStudent === studentId ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </div>

              <AnimatePresence>
                {expandedStudent === studentId && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-slate-100 bg-slate-50/50"
                  >
                    <div className="p-3 space-y-2">
                      {studentSubs.map((sub, idx) => (
                        <div
                          key={sub.id}
                          className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100 shadow-sm"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-center justify-center w-10 h-10 bg-slate-50 rounded-lg border border-slate-100 shrink-0">
                              <span className="text-[10px] text-slate-400 font-medium uppercase">
                                {T.attemptPrefix}
                              </span>
                              <span className="text-sm font-bold text-slate-700">
                                {studentSubs.length - idx}
                              </span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase',
                                    sub.status === 'graded'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-amber-100 text-amber-700'
                                  )}
                                >
                                  {sub.status === 'graded' ? T.graded : T.ungraded}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {formatVN(sub.submittedAt, 'dd/MM/yyyy HH:mm')}
                                </span>
                              </div>
                              {sub.status === 'graded' && sub.grade !== undefined && (
                                <p className="text-xs font-medium text-emerald-600 mt-0.5">
                                  {T.scoreLabel.replace('{grade}', String(sub.grade))}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="relative group">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewSub(sub);
                                }}
                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title={T.quickPreview}
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onGrade(sub);
                              }}
                              className={cn(
                                'text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm',
                                sub.status === 'graded'
                                  ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100'
                              )}
                            >
                              {sub.status === 'graded' ? T.viewSubmission : T.gradeSubmission}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        )}
        {filteredStudents.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm italic bg-slate-50 rounded-xl border border-slate-100">
            {T.noFilteredSubmissions}
          </div>
        )}
      </div>

      {/* Quick Preview Modal */}
      <AnimatePresence>
        {previewSub && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
              >
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold">
                      {getStudentName(previewSub.studentId)[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">
                        {getStudentName(previewSub.studentId)}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {T.submittedAt}
                        {formatVN(previewSub.submittedAt, 'HH:mm dd/MM/yyyy')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPreviewSub(null)}
                    className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    {T.contentTitle}
                  </h4>

                  {isAssessmentV2 ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">
                        {T.assessmentSummary.replace(
                          '{count}',
                          (previewSub.assessmentAnswers?.length || 0).toString()
                        )}
                      </p>
                      <p className="text-xs text-slate-500 italic">{T.assessmentNotice}</p>
                    </div>
                  ) : assignmentType === 'quiz' ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">
                        {T.quizSummary.replace(
                          '{count}',
                          (previewSub.quizAnswers?.length || 0).toString()
                        )}
                      </p>
                      <p className="text-xs text-slate-500 italic">{T.quizNotice}</p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {previewSub.content || (
                        <span className="text-slate-400 italic">{T.noContent}</span>
                      )}
                    </div>
                  )}

                  {previewSub.examIntegrity && (
                    <div className="mt-6">
                      <h4 className="text-sm font-bold text-slate-800 mb-3">{T.antiCheatTitle}</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-amber-50 p-3 rounded-xl border border-amber-100">
                          <p className="text-xs text-amber-700 font-medium">
                            {T.tabSwitchFocusLoss}
                          </p>
                          <p className="text-lg font-bold text-amber-900">
                            {(previewSub.examIntegrity.tabSwitchCount || 0) +
                              (previewSub.examIntegrity.focusLossCount || 0)}{' '}
                            {T.times}
                          </p>
                        </div>
                        <div className="bg-red-50 p-3 rounded-xl border border-red-100">
                          <p className="text-xs text-red-700 font-medium">{T.fullscreenExit}</p>
                          <p className="text-lg font-bold text-red-900">
                            {previewSub.examIntegrity.fullscreenExitCount || 0} {T.times}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                  <button
                    onClick={() => setPreviewSub(null)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl font-medium hover:bg-slate-100 transition-colors text-sm"
                  >
                    {T.close}
                  </button>
                  <button
                    onClick={() => {
                      onGrade(previewSub);
                      setPreviewSub(null);
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm text-sm"
                  >
                    {previewSub.status === 'graded' ? T.viewDetails : T.gradeNow}
                  </button>
                </div>
              </motion.div>
            </div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}
