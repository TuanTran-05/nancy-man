import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ShieldAlert, Check, RefreshCw } from 'lucide-react';
import { Submission, Assignment, Student } from '../../types';
import { cn } from '../../lib/core/utils';
import { formatVN } from '../../lib/core/utils';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import type {
  AssessmentQuestionGradeInput,
  PrivateAssessmentQuestionKey,
} from '../../../shared/assignmentAssessment';
import { apiRequest } from '../../lib/api/apiClient';
import { AssessmentSubmissionReview } from './assessmentReview/AssessmentSubmissionReview';
import {
  buildAssessmentGradePayload,
  buildAssessmentGradingDraft,
  type AssessmentGradingDraft,
} from './assessmentReview/assessmentReviewState';

interface GradingSubmitPayload {
  assessmentQuestionScores?: AssessmentQuestionGradeInput[];
}

interface GradingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedSubmission: Submission | null;
  assignments: Assignment[];
  students: Student[];
  gradingData: { grade: string; feedback: string };
  setGradingData: (data: { grade: string; feedback: string }) => void;
  onSubmit: (e: React.FormEvent, payload?: GradingSubmitPayload) => void;
  isGrading: boolean;
  INTEGRITY_TAB_FOCUS_AUTO_SUBMIT: number;
  INTEGRITY_FULLSCREEN_AUTO_SUBMIT: number;
}

export function GradingModal({
  isOpen,
  onClose,
  selectedSubmission,
  assignments,
  students,
  gradingData,
  setGradingData,
  onSubmit,
  isGrading,
  INTEGRITY_TAB_FOCUS_AUTO_SUBMIT,
  INTEGRITY_FULLSCREEN_AUTO_SUBMIT,
}: GradingModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const [correctAnswers, setCorrectAnswers] = useState<Record<string, string>>({});
  const [assessmentKeyMap, setAssessmentKeyMap] = useState<
    Record<string, PrivateAssessmentQuestionKey>
  >({});
  const [assessmentDraft, setAssessmentDraft] = useState<AssessmentGradingDraft>({});

  const assignment = assignments.find((a) => a.id === selectedSubmission?.assignmentId);
  const isAssessmentV2 = assignment?.assessment?.version === 2;

  useEffect(() => {
    if (!isOpen || !assignment?.assessment || !selectedSubmission) {
      setAssessmentDraft({});
      return;
    }
    setAssessmentDraft(
      buildAssessmentGradingDraft(assignment.assessment, selectedSubmission.assessmentScore)
    );
  }, [isOpen, assignment, selectedSubmission]);

  useEffect(() => {
    if (!isOpen || !assignment?.assessment || assignment.assessment.version !== 2) {
      setAssessmentKeyMap({});
      return;
    }

    const fetchKeys = async () => {
      try {
        const response = await apiRequest<{
          success: boolean;
          data: Record<string, PrivateAssessmentQuestionKey>;
        }>(`/api/v1/edu/get-assessment-question-keys?assignmentId=${assignment.id}`);
        setAssessmentKeyMap(response.data || {});
      } catch {
        setAssessmentKeyMap({});
      }
    };

    void fetchKeys();
  }, [isOpen, assignment]);

  useEffect(() => {
    if (!isOpen || !assignment || assignment.type !== 'quiz') {
      setCorrectAnswers({});
      return;
    }
    const fetchAnswers = async () => {
      try {
        const response = await apiRequest<{ success: boolean; data: Record<string, string> }>(
          `/api/v1/edu/get-quiz-answers?assignmentId=${assignment.id}`
        );
        setCorrectAnswers(response.data || {});
      } catch {
        setCorrectAnswers({});
      }
    };
    fetchAnswers();
  }, [isOpen, assignment]);

  if (!isOpen || !selectedSubmission) return null;

  const getStudentName = (id: string) =>
    students.find((s) => s.id === id)?.name || t.gradingModal.studentFallback;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-blue-600 text-white">
            <div>
              <h2 className="text-xl font-bold">{t.gradingModal.title}</h2>
              <p className="text-blue-100 text-xs">
                {t.gradingModal.studentPrefix} {getStudentName(selectedSubmission.studentId)}
              </p>
            </div>
            <button
              type="button"
              aria-label={t.gradingModal.closeLabel}
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <form
            onSubmit={(event) =>
              onSubmit(
                event,
                isAssessmentV2
                  ? { assessmentQuestionScores: buildAssessmentGradePayload(assessmentDraft) }
                  : undefined
              )
            }
            className="p-6 space-y-4 max-h-[70vh] overflow-y-auto"
          >
            {(() => {
              if (isAssessmentV2 && assignment?.assessment) {
                return (
                  <AssessmentSubmissionReview
                    assessment={assignment.assessment}
                    answers={selectedSubmission.assessmentAnswers || []}
                    score={selectedSubmission.assessmentScore}
                    keyMap={assessmentKeyMap}
                    canGrade
                    showCorrectAnswers
                    gradingDraft={assessmentDraft}
                    onDraftChange={setAssessmentDraft}
                    submissionStatus={selectedSubmission.status}
                  />
                );
              }
              if (assignment?.type === 'quiz') {
                return (
                  <div className="space-y-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      {t.gradingModal.quizResults}
                    </p>
                    {assignment.questions?.map((q, idx) => {
                      const studentAnswer = selectedSubmission.quizAnswers?.find(
                        (a) => a.questionId === q.id
                      )?.selectedOption;
                      const correctAnswer = correctAnswers[String(q.id)];
                      const isCorrect = studentAnswer === correctAnswer;
                      return (
                        <div
                          key={q.id}
                          className={cn(
                            'p-3 rounded-xl border',
                            isCorrect
                              ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20'
                              : 'bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20'
                          )}
                        >
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                            {idx + 1}. {q.question_content}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {q.options.map((opt) => (
                              <div
                                key={opt.key}
                                className={cn(
                                  'text-xs p-1.5 rounded flex items-center justify-between',
                                  opt.key === correctAnswer
                                    ? 'bg-emerald-200 text-emerald-800 font-bold dark:bg-emerald-500/20 dark:text-emerald-400'
                                    : opt.key === studentAnswer
                                      ? 'bg-red-200 text-red-800 font-bold dark:bg-red-500/20 dark:text-red-400'
                                      : 'bg-white text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                )}
                              >
                                <span>
                                  {opt.key}. {opt.text}
                                </span>
                                {opt.key === correctAnswer && <Check className="w-3 h-3" />}
                                {opt.key === studentAnswer && !isCorrect && (
                                  <X className="w-3 h-3" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }
              return (
                <div className="p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-100 dark:border-slate-600 mb-4 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    {t.gradingModal.submissionContent}
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                    {selectedSubmission.content}
                  </p>
                </div>
              );
            })()}

            {selectedSubmission.examIntegrity && (
              <div className="p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-100 dark:border-amber-500/20 mb-2">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {t.gradingModal.examTracking}
                </p>
                <ul className="text-xs text-amber-900 dark:text-amber-300 space-y-1">
                  <li>
                    {t.gradingModal.tabSwitches}{' '}
                    <strong>{selectedSubmission.examIntegrity.tabSwitchCount}</strong>
                  </li>
                  <li>
                    {t.gradingModal.focusLosses}{' '}
                    <strong>{selectedSubmission.examIntegrity.focusLossCount}</strong>
                  </li>
                  <li>
                    {t.gradingModal.fullscreenExits}{' '}
                    <strong>{selectedSubmission.examIntegrity.fullscreenExitCount}</strong>
                  </li>
                  {selectedSubmission.examIntegrity.sessionStartedAt && (
                    <li className="text-amber-800/80 dark:text-amber-400/80">
                      {t.gradingModal.sessionStarted}{' '}
                      {formatVN(
                        selectedSubmission.examIntegrity.sessionStartedAt,
                        'dd/MM/yyyy HH:mm'
                      )}
                    </li>
                  )}
                  {selectedSubmission.examIntegrity.autoSubmitted && (
                    <li className="pt-1 mt-1 border-t border-amber-200 dark:border-amber-500/30 text-red-800 dark:text-red-400 font-semibold">
                      {t.gradingModal.autoSubmitted}
                      {selectedSubmission.examIntegrity.autoSubmitReason === 'tab_focus_limit'
                        ? ` (${t.gradingModal.autoSubmitTabReason.replace('{count}', String(INTEGRITY_TAB_FOCUS_AUTO_SUBMIT))}).`
                        : selectedSubmission.examIntegrity.autoSubmitReason ===
                            'fullscreen_exit_limit'
                          ? ` (${t.gradingModal.autoSubmitFullscreenReason.replace('{count}', String(INTEGRITY_FULLSCREEN_AUTO_SUBMIT))}).`
                          : '.'}
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  {t.gradingModal.scoreLabel}
                </label>
                <input
                  required={assignment?.type !== 'quiz'}
                  readOnly={assignment?.type === 'quiz'}
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={gradingData.grade}
                  onChange={(e) => setGradingData({ ...gradingData, grade: e.target.value })}
                  className={cn(
                    'w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all',
                    assignment?.type === 'quiz'
                      ? 'bg-slate-100 border-slate-100 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400 cursor-not-allowed'
                      : 'bg-slate-50 border-slate-100 dark:bg-slate-700 dark:border-slate-600'
                  )}
                />
              </div>
              <div className="col-span-3">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  {t.gradingModal.commentLabel}
                </label>
                <input
                  type="text"
                  value={gradingData.feedback}
                  onChange={(e) => setGradingData({ ...gradingData, feedback: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder={t.gradingModal.commentPlaceholder}
                />
              </div>
            </div>
            <div className="pt-4 flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-slate-100 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={isGrading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isGrading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {t.gradingModal.saving}
                  </>
                ) : assignment?.type === 'quiz' && !isAssessmentV2 ? (
                  t.gradingModal.updateComment
                ) : (
                  t.gradingModal.saveResult
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
