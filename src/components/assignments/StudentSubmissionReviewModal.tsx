import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, CheckCircle, XCircle } from 'lucide-react';
import { Assignment, Submission } from '../../types';
import { cn } from '../../lib/core/utils';
import { formatVN } from '../../lib/core/utils';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import { apiRequest } from '../../lib/api/apiClient';
import type { PrivateAssessmentQuestionKey } from '../../../shared/assignmentAssessment';
import { AssessmentSubmissionReview } from './assessmentReview/AssessmentSubmissionReview';

interface StudentSubmissionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment | null;
  submission: Submission | null;
  showCorrectAnswers: boolean;
}

export function StudentSubmissionReviewModal({
  isOpen,
  onClose,
  assignment,
  submission,
  showCorrectAnswers,
}: StudentSubmissionReviewModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const [correctAnswers, setCorrectAnswers] = useState<Record<string, string>>({});
  const [assessmentKeyMap, setAssessmentKeyMap] = useState<
    Record<string, PrivateAssessmentQuestionKey>
  >({});

  const isAssessmentV2 = assignment?.assessment?.version === 2;
  const canShowReleasedResult = !isAssessmentV2 || showCorrectAnswers;
  const isAwaitingAssessmentGrading = isAssessmentV2 && submission?.status === 'submitted';

  useEffect(() => {
    if (!isOpen || !assignment?.assessment || !showCorrectAnswers) {
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
  }, [isOpen, assignment, showCorrectAnswers]);

  useEffect(() => {
    if (!isOpen || !assignment || !showCorrectAnswers || assignment.type !== 'quiz') {
      setCorrectAnswers({});
      return;
    }
    const fetchAnswers = async () => {
      try {
        const response = await apiRequest<{ success: boolean; data: Record<string, string> }>(
          `/api/v1/edu/get-quiz-answers?assignmentId=${assignment.id}`
        );
        if (response && response.data) {
          setCorrectAnswers(response.data);
        } else {
          setCorrectAnswers({});
        }
      } catch {
        setCorrectAnswers({});
      }
    };
    fetchAnswers();
  }, [isOpen, assignment, showCorrectAnswers]);

  if (!isOpen || !assignment || !submission) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-2 bg-blue-600 text-white shrink-0">
            <div className="min-w-0">
              <h2 className="text-xl font-bold">{t.studentSubmissionReviewModal.title}</h2>
              <p className="text-blue-100 text-xs truncate">
                {t.studentSubmissionReviewModal.submittedAtLabel
                  .replace('{time}', formatVN(submission.submittedAt, 'dd/MM/yyyy HH:mm'))
                  .replace('{title}', assignment.title)}
              </p>
            </div>
            <button
              type="button"
              aria-label={t.studentSubmissionReviewModal.close}
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors shrink-0"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto space-y-6">
            {isAwaitingAssessmentGrading && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                {t.studentSubmissionReviewModal.awaitingGrading}
              </div>
            )}

            {canShowReleasedResult &&
              submission.status === 'graded' &&
              submission.grade !== undefined &&
              submission.grade !== null && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <p className="text-xs font-black uppercase text-emerald-700">
                    {t.studentSubmissionReviewModal.graded}
                  </p>
                  <p className="mt-1 text-2xl font-black">
                    {t.studentSubmissionReviewModal.scoreLabel.replace(
                      '{grade}',
                      String(submission.grade)
                    )}
                  </p>
                  {submission.feedback ? (
                    <p className="mt-2 whitespace-pre-wrap font-semibold">{submission.feedback}</p>
                  ) : (
                    <p className="mt-2 font-semibold">
                      {t.studentSubmissionReviewModal.noComments}
                    </p>
                  )}
                </div>
              )}

            {!showCorrectAnswers && (
              <div className="p-4 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-500/20 text-sm">
                {isAssessmentV2
                  ? t.studentSubmissionReviewModal.answersLockedByPolicy
                  : t.studentSubmissionReviewModal.answersWillShow}
              </div>
            )}

            {assignment.assessment?.version === 2 ? (
              <AssessmentSubmissionReview
                assessment={assignment.assessment}
                answers={submission.assessmentAnswers || []}
                score={canShowReleasedResult ? submission.assessmentScore : null}
                keyMap={assessmentKeyMap}
                canGrade={false}
                showCorrectAnswers={showCorrectAnswers}
                submissionStatus={submission.status}
              />
            ) : assignment.type === 'quiz' && assignment.questions ? (
              <div className="space-y-6">
                {assignment.questions.map((q, qIndex) => {
                  const studentAnswer = submission.quizAnswers?.find(
                    (a) => a.questionId === q.id
                  )?.selectedOption;
                  const correctAnswer = correctAnswers[String(q.id)];
                  const isCorrect = studentAnswer === correctAnswer;

                  return (
                    <div
                      key={q.id}
                      className="p-5 rounded-2xl bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600"
                    >
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex gap-3">
                          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 text-sm font-bold shrink-0">
                            {qIndex + 1}
                          </span>
                          <p className="text-slate-900 dark:text-slate-100 font-medium leading-relaxed">
                            {q.question_content}
                          </p>
                        </div>
                        {showCorrectAnswers && (
                          <div className="shrink-0">
                            {isCorrect ? (
                              <CheckCircle className="w-6 h-6 text-emerald-500" />
                            ) : (
                              <XCircle className="w-6 h-6 text-red-500" />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-9">
                        {q.options.map((opt) => {
                          const isSelected = studentAnswer === opt.key;
                          const isActuallyCorrect = correctAnswer === opt.key;

                          let optionClass =
                            'p-3 rounded-xl border transition-colors text-sm flex items-center gap-3';

                          if (showCorrectAnswers) {
                            if (isActuallyCorrect) {
                              optionClass = cn(
                                optionClass,
                                'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-medium'
                              );
                            } else if (isSelected && !isActuallyCorrect) {
                              optionClass = cn(
                                optionClass,
                                'bg-red-50 dark:bg-red-500/10 border-red-500 dark:border-red-500/30 text-red-700 dark:text-red-400'
                              );
                            } else {
                              optionClass = cn(
                                optionClass,
                                'bg-slate-50 dark:bg-slate-600 border-slate-100 dark:border-slate-500 text-slate-600 dark:text-slate-300 opacity-60'
                              );
                            }
                          } else {
                            if (isSelected) {
                              optionClass = cn(
                                optionClass,
                                'bg-blue-50 dark:bg-blue-500/10 border-blue-500 dark:border-blue-500/30 text-blue-700 dark:text-blue-400'
                              );
                            } else {
                              optionClass = cn(
                                optionClass,
                                'bg-slate-50 dark:bg-slate-600 border-slate-100 dark:border-slate-500 text-slate-600 dark:text-slate-300 opacity-70'
                              );
                            }
                          }

                          return (
                            <div key={opt.key} className={optionClass}>
                              <span
                                className={cn(
                                  'w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0 shadow-sm',
                                  showCorrectAnswers && isActuallyCorrect
                                    ? 'bg-emerald-500 text-white'
                                    : showCorrectAnswers && isSelected && !isActuallyCorrect
                                      ? 'bg-red-500 text-white'
                                      : isSelected && !showCorrectAnswers
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 text-slate-500 dark:text-slate-400'
                                )}
                              >
                                {opt.key}
                              </span>
                              <span className="flex-1">{opt.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-100 dark:border-slate-600">
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                    {t.studentSubmissionReviewModal.yourSubmission}
                  </p>
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {submission.content}
                  </p>
                </div>

                {submission.status === 'graded' && (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                        {t.studentSubmissionReviewModal.teacherEvaluation}
                      </p>
                      <span className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-sm">
                        {t.studentSubmissionReviewModal.scoreLabel.replace(
                          '{grade}',
                          String(submission.grade)
                        )}
                      </span>
                    </div>
                    <p className="text-emerald-800 dark:text-emerald-300">
                      {submission.feedback || t.studentSubmissionReviewModal.noComments}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
