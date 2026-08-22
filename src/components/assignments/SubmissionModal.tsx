import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  AlignJustify,
  AlignLeft,
  ArrowLeft,
  ArrowRight,
  Bold,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Grid3X3,
  Image as ImageIcon,
  Italic,
  Keyboard,
  Lightbulb,
  List,
  ListOrdered,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Target,
  Underline,
  X,
} from 'lucide-react';
import { Assignment, QuizAnswer } from '../../types';
import { cn } from '../../lib/core/utils';
import { StudentDictionaryPanel } from '../students/StudentDictionaryPanel';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import type { AssignmentProctoringMode } from '../../../shared/assignmentProctoring';
import type { AssessmentAnswer } from '../../../shared/assignmentAssessment';
import { getAssessmentProgress } from '../../../shared/assignmentAssessment';
import { StudentAssessmentRunner } from './assessmentRunner/StudentAssessmentRunner';
import type { AttemptAutosaveStatus } from './attempt/useAssignmentAttemptAutosave';

const ESSAY_LIMIT = 3000;

interface SubmissionModalProps {
  isOpen: boolean;
  onClose: () => Promise<void>;
  selectedAssignment: Assignment | null;
  submissionExamActive: boolean;
  dictionaryOpen: boolean;
  setDictionaryOpen: (val: boolean) => void;
  onStartExamSession: () => Promise<void>;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
  submissionData: { content: string };
  setSubmissionData: (data: { content: string }) => void;
  quizAnswers: QuizAnswer[];
  setQuizAnswers: (answers: QuizAnswer[]) => void;
  examMetrics: {
    tabSwitchCount: number;
    focusLossCount: number;
    fullscreenExitCount: number;
    sessionStartedAt: string | null;
  };
  integrityOverlay:
    | { kind: 'tabfocus'; total: number }
    | { kind: 'fullscreen'; exitCount: number }
    | { kind: 'devtools'; total: number }
    | null;
  setIntegrityOverlay: (
    val:
      | { kind: 'tabfocus'; total: number }
      | { kind: 'fullscreen'; exitCount: number }
      | { kind: 'devtools'; total: number }
      | null
  ) => void;
  INTEGRITY_TAB_FOCUS_WARN: number;
  INTEGRITY_TAB_FOCUS_AUTO_SUBMIT: number;
  INTEGRITY_FULLSCREEN_AUTO_SUBMIT: number;
  proctoringMode: AssignmentProctoringMode;
  assessmentAnswers: AssessmentAnswer[];
  setAssessmentAnswers: (answers: AssessmentAnswer[]) => void;
  attemptDraftStatus: AttemptAutosaveStatus;
  attemptDraftRestored: boolean;
  onClearAttemptDraft: () => void;
}

function formatRemainingTime(dueDate?: string, now = Date.now()) {
  if (!dueDate) return '--:--';
  const due = new Date(dueDate).getTime();
  if (!Number.isFinite(due)) return '--:--';

  const remaining = Math.max(0, due - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function EssayToolbarButton({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <button
      type="button"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function SubmissionModal({
  isOpen,
  onClose,
  selectedAssignment,
  submissionExamActive,
  dictionaryOpen,
  setDictionaryOpen,
  onStartExamSession,
  onSubmit,
  isSubmitting,
  submissionData,
  setSubmissionData,
  quizAnswers,
  setQuizAnswers,
  examMetrics,
  integrityOverlay,
  setIntegrityOverlay,
  INTEGRITY_TAB_FOCUS_WARN,
  INTEGRITY_TAB_FOCUS_AUTO_SUBMIT,
  INTEGRITY_FULLSCREEN_AUTO_SUBMIT,
  proctoringMode,
  assessmentAnswers,
  setAssessmentAnswers,
  attemptDraftStatus,
  attemptDraftRestored,
  onClearAttemptDraft,
}: SubmissionModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();

  const [now, setNow] = React.useState(() => Date.now());
  const [activeQuestionId, setActiveQuestionId] = React.useState<number | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const questionRefs = React.useRef<Record<number, HTMLElement | null>>({});

  const questions = React.useMemo(
    () => selectedAssignment?.questions || [],
    [selectedAssignment?.questions]
  );
  const isAssessmentV2 = selectedAssignment?.assessment?.version === 2;
  const isQuiz = selectedAssignment?.type === 'quiz' && !isAssessmentV2;
  const assessmentProgress = React.useMemo(
    () =>
      selectedAssignment?.assessment
        ? getAssessmentProgress(selectedAssignment.assessment, assessmentAnswers)
        : { answered: 0, total: 0, percent: 0 },
    [assessmentAnswers, selectedAssignment?.assessment]
  );
  const answeredQuestionIds = React.useMemo(
    () => new Set(quizAnswers.map((answer) => answer.questionId)),
    [quizAnswers]
  );
  const answeredCount = isAssessmentV2
    ? assessmentProgress.answered
    : isQuiz
      ? answeredQuestionIds.size
      : submissionData.content.trim().length > 0
        ? 1
        : 0;
  const totalCount = isAssessmentV2 ? assessmentProgress.total : isQuiz ? questions.length : 1;
  const currentQuestionId = React.useMemo(() => {
    if (!isQuiz || questions.length === 0) return null;
    if (activeQuestionId && questions.some((question) => question.id === activeQuestionId)) {
      return activeQuestionId;
    }
    return questions[0].id;
  }, [activeQuestionId, isQuiz, questions]);
  const progress = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  const combinedFocusLoss = examMetrics.tabSwitchCount + examMetrics.focusLossCount;
  const remainingTime = formatRemainingTime(selectedAssignment?.dueDate, now);
  const isStrictProctoring = proctoringMode === 'strict';
  const draftStatusLabel =
    attemptDraftStatus === 'saving'
      ? t.submissionModal.draftSaving
      : attemptDraftStatus === 'saved'
        ? t.submissionModal.draftSaved
        : attemptDraftStatus === 'offline'
          ? t.submissionModal.draftOffline
          : attemptDraftStatus === 'error'
            ? t.submissionModal.draftError
            : '';

  const goToQuestion = React.useCallback((questionId: number) => {
    setActiveQuestionId(questionId);
    window.requestAnimationFrame(() => {
      questionRefs.current[questionId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  React.useEffect(() => {
    if (!isOpen || !submissionExamActive) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, submissionExamActive]);

  React.useEffect(() => {
    if (!isOpen || !submissionExamActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }

      if (!isQuiz || questions.length === 0) return;

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const currentIndex = Math.max(
        0,
        questions.findIndex((question) => question.id === currentQuestionId)
      );
      const nextIndex =
        event.key === 'ArrowRight'
          ? Math.min(questions.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);

      event.preventDefault();
      goToQuestion(questions[nextIndex].id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentQuestionId, goToQuestion, isOpen, isQuiz, questions, submissionExamActive]);

  if (!isOpen || !selectedAssignment || typeof document === 'undefined') return null;

  const typeLabel = isAssessmentV2
    ? t.submissionModal.assessment
    : isQuiz
      ? t.submissionModal.multipleChoice
      : t.submissionModal.essay;
  const statusItems = [
    {
      icon: BookOpen,
      label: t.submissionModal.topic,
      value: selectedAssignment.description || selectedAssignment.title,
      color: 'text-blue-600',
    },
    ...(isStrictProctoring
      ? [
          {
            icon: Target,
            label: t.submissionModal.lostFocus,
            value: examMetrics.focusLossCount,
            color: 'text-orange-500',
          },
          {
            icon: ShieldCheck,
            label: t.submissionModal.totalFocusWarning
              .replace('{warnLimit}', String(INTEGRITY_TAB_FOCUS_WARN))
              .replace('{autoLimit}', String(INTEGRITY_TAB_FOCUS_AUTO_SUBMIT)),
            value: combinedFocusLoss,
            color: 'text-emerald-600',
          },
          {
            icon: AlertTriangle,
            label: t.submissionModal.fullExit,
            value: t.submissionModal.fullExitProgress
              .replace('{count}', String(examMetrics.fullscreenExitCount))
              .replace('{limit}', String(INTEGRITY_FULLSCREEN_AUTO_SUBMIT)),
            color: 'text-violet-500',
          },
        ]
      : []),
  ];

  const answerQuestion = (questionId: number, selectedOption: string) => {
    const nextAnswers = quizAnswers.filter((answer) => answer.questionId !== questionId);
    nextAnswers.push({ questionId, selectedOption });
    setQuizAnswers(nextAnswers);
    setActiveQuestionId(questionId);
  };

  const progressRingStyle = {
    background: `conic-gradient(#2563eb ${progress * 3.6}deg, #e8edf5 0deg)`,
  };

  const modalContent = (
    <>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-0 backdrop-blur-md sm:p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          className={cn(
            'flex w-full max-w-[1720px] flex-col overflow-hidden bg-white shadow-2xl',
            submissionExamActive
              ? 'h-dvh rounded-none sm:h-[min(94vh,980px)] sm:rounded-[1.75rem]'
              : 'max-h-[94vh] max-w-3xl rounded-none sm:rounded-[1.75rem]'
          )}
        >
          <div className="shrink-0 border-b border-slate-100 bg-white/95 px-5 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-200">
                  <ClipboardList className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-black leading-tight text-slate-950">
                      {t.submissionModal.doAssignment}
                    </h2>
                    <span className="rounded-lg bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700">
                      {typeLabel}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-slate-500">
                    {selectedAssignment.title}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {submissionExamActive && draftStatusLabel && (
                  <span className="hidden rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 sm:inline-flex">
                    {draftStatusLabel}
                  </span>
                )}
                {submissionExamActive && (
                  <>
                    <button
                      type="button"
                      onClick={() => setDictionaryOpen(true)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100 sm:px-4"
                    >
                      <BookOpen className="h-4 w-4" />
                      <span className="hidden sm:inline">{t.submissionModal.dictionary}</span>
                    </button>
                    <div className="hidden items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 shadow-sm sm:flex">
                      <Clock3 className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="text-xs font-medium text-slate-500">
                          {t.submissionModal.timeRemaining}
                        </p>
                        <p className="text-xl font-black leading-none text-blue-600">
                          {remainingTime}
                        </p>
                      </div>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void onClose()}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
                  aria-label={t.submissionModal.closeLabel}
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>
          </div>

          {!submissionExamActive ? (
            <div className="overflow-y-auto px-5 py-6 sm:px-8">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-blue-700">
                  <FileText className="h-5 w-5" />
                  {t.submissionModal.requirements}
                </div>
                <p className="text-base font-medium leading-7 text-slate-700">
                  {selectedAssignment.description || t.submissionModal.noExtraRequests}
                </p>
              </div>

              {isStrictProctoring ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black text-amber-800">
                    <ShieldAlert className="h-5 w-5" />
                    {t.submissionModal.strictMode}
                  </div>
                  <div className="grid gap-3 text-sm leading-6 text-amber-900 sm:grid-cols-2">
                    <p>{t.submissionModal.strictNoFullscreen}</p>
                    <p>{t.submissionModal.strictTabSwitch}</p>
                    <p>{t.submissionModal.strictQuizEmpty}</p>
                    <p>{t.submissionModal.strictDictionary}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black text-emerald-800">
                    <ShieldCheck className="h-5 w-5" />
                    {t.submissionModal.normalMode}
                  </div>
                  <div className="grid gap-3 text-sm leading-6 text-emerald-900 sm:grid-cols-2">
                    <p>{t.submissionModal.normalTabSwitchAllowed}</p>
                    <p>{t.submissionModal.normalNoFullscreen}</p>
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void onClose()}
                  className="flex-1 rounded-2xl border border-slate-200 px-5 py-3 font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  {t.submissionModal.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => void onStartExamSession()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
                >
                  {isStrictProctoring ? (
                    <Maximize2 className="h-5 w-5" />
                  ) : (
                    <ClipboardList className="h-5 w-5" />
                  )}
                  {isStrictProctoring
                    ? t.submissionModal.startFullscreen
                    : t.submissionModal.startNormal}
                </button>
              </div>
            </div>
          ) : (
            <form ref={formRef} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
              {attemptDraftRestored && (
                <div className="mx-5 mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 sm:mx-8 sm:flex-row sm:items-center sm:justify-between">
                  <span>{t.submissionModal.draftRestored}</span>
                  <button
                    type="button"
                    onClick={onClearAttemptDraft}
                    className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100"
                  >
                    {t.submissionModal.discardSavedDraft}
                  </button>
                </div>
              )}
              <div className="shrink-0 px-5 py-4 sm:px-8">
                <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
                  {statusItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="flex min-w-0 items-center gap-3">
                        <Icon className={cn('h-5 w-5 shrink-0', item.color)} />
                        <div className="min-w-0 text-sm font-bold text-slate-800">
                          <span>{item.label}: </span>
                          <span className="text-slate-950">{item.value}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28 sm:px-8">
                <div
                  className={cn(
                    'grid gap-6',
                    isQuiz
                      ? 'xl:grid-cols-[minmax(0,1fr)_29rem]'
                      : 'xl:grid-cols-[minmax(0,1fr)_25rem]'
                  )}
                >
                  <div className="min-w-0 space-y-5">
                    {!isQuiz && (
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase text-blue-700">
                          <FileText className="h-5 w-5" />
                          {t.submissionModal.requirements}
                        </div>
                        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-5 text-lg font-semibold leading-8 text-blue-700">
                          {selectedAssignment.description || t.submissionModal.noExtraRequests}
                        </div>
                      </div>
                    )}

                    {isAssessmentV2 && selectedAssignment.assessment ? (
                      <StudentAssessmentRunner
                        assignmentId={selectedAssignment.id}
                        classId={selectedAssignment.classId}
                        assessment={selectedAssignment.assessment}
                        answers={assessmentAnswers}
                        onAnswersChange={setAssessmentAnswers}
                      />
                    ) : isQuiz ? (
                      <div className="space-y-5">
                        {questions.map((question, index) => {
                          const selectedOption = quizAnswers.find(
                            (answer) => answer.questionId === question.id
                          )?.selectedOption;

                          return (
                            <section
                              key={question.id}
                              ref={(node) => {
                                questionRefs.current[question.id] = node;
                              }}
                              className={cn(
                                'rounded-2xl border bg-white p-5 shadow-sm transition',
                                currentQuestionId === question.id
                                  ? 'border-orange-200 ring-2 ring-orange-100'
                                  : 'border-slate-200'
                              )}
                            >
                              <div className="mb-5 flex items-start gap-4">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">
                                  {index + 1}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <h3 className="text-base font-black leading-7 text-slate-950">
                                      {question.question_content}
                                    </h3>
                                    {question.level && (
                                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-black uppercase text-slate-500">
                                        {question.level}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="grid gap-3">
                                {question.options.map((option) => {
                                  const isSelected = selectedOption === option.key;

                                  return (
                                    <button
                                      key={option.key}
                                      type="button"
                                      onClick={() => answerQuestion(question.id, option.key)}
                                      className={cn(
                                        'flex min-h-14 items-center gap-4 rounded-xl border px-4 text-left transition',
                                        isSelected
                                          ? 'border-emerald-400 bg-emerald-50 text-emerald-700 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]'
                                          : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/40'
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black',
                                          isSelected
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-slate-100 text-slate-500'
                                        )}
                                      >
                                        {option.key}
                                      </span>
                                      <span className="min-w-0 flex-1 text-base font-medium">
                                        {option.text}
                                      </span>
                                      {isSelected && (
                                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                          <Check className="h-4 w-4" />
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <label
                            htmlFor="essay-answer"
                            className="text-base font-black text-slate-950"
                          >
                            {t.submissionModal.yourAnswer}
                          </label>
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                            <Lightbulb className="h-4 w-4 text-amber-400" />
                            {t.submissionModal.answerFullHint}
                          </div>
                        </div>
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                          <textarea
                            id="essay-answer"
                            rows={12}
                            maxLength={ESSAY_LIMIT}
                            value={submissionData.content}
                            onChange={(event) =>
                              setSubmissionData({
                                ...submissionData,
                                content: event.target.value,
                              })
                            }
                            className="min-h-[300px] w-full resize-none border-0 bg-slate-50 px-5 py-4 text-base leading-7 text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
                            placeholder={t.submissionModal.answerPlaceholder}
                          />
                          <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap items-center gap-1">
                              <EssayToolbarButton icon={RotateCcw} label={t.submissionModal.undo} />
                              <EssayToolbarButton icon={Bold} label={t.submissionModal.bold} />
                              <EssayToolbarButton icon={Italic} label={t.submissionModal.italic} />
                              <EssayToolbarButton
                                icon={Underline}
                                label={t.submissionModal.underline}
                              />
                              <EssayToolbarButton
                                icon={List}
                                label={t.submissionModal.bulletList}
                              />
                              <EssayToolbarButton
                                icon={ListOrdered}
                                label={t.submissionModal.numberedList}
                              />
                              <EssayToolbarButton
                                icon={AlignLeft}
                                label={t.submissionModal.alignLeft}
                              />
                              <EssayToolbarButton
                                icon={AlignJustify}
                                label={t.submissionModal.justify}
                              />
                              <EssayToolbarButton
                                icon={ImageIcon}
                                label={t.submissionModal.insertImage}
                              />
                            </div>
                            <span className="text-right text-sm font-bold text-slate-400">
                              {t.submissionModal.characterCount
                                .replace('{count}', String(submissionData.content.length))
                                .replace('{limit}', String(ESSAY_LIMIT))}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {!isAssessmentV2 && (
                    <aside className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-4 text-base font-black uppercase text-blue-700">
                          {t.submissionModal.examProgress}
                        </h3>
                        <div className="flex items-center gap-6">
                          <div
                            className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full p-2"
                            style={progressRingStyle}
                          >
                            <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-2xl font-black text-slate-950">
                              {progress}%
                            </div>
                          </div>
                          <div>
                            <p className="text-2xl font-black text-slate-950">
                              {answeredCount}/{totalCount}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-500">
                              {isQuiz
                                ? t.submissionModal.answeredQuestions
                                : t.submissionModal.completedSections}
                            </p>
                            <div className="mt-4 flex items-center gap-2 text-blue-600 sm:hidden">
                              <Clock3 className="h-5 w-5" />
                              <span className="text-xl font-black">{remainingTime}</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>

                      {isQuiz && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                          <h3 className="mb-4 text-base font-black text-slate-900">
                            {t.submissionModal.questionList}
                          </h3>
                          <div className="mb-4 flex flex-wrap gap-4 text-xs font-medium text-slate-600">
                            <span className="flex items-center gap-1.5">
                              <span className="h-3 w-3 rounded-full bg-emerald-500" />
                              {t.submissionModal.answered}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="h-3 w-3 rounded-full bg-orange-500" />
                              {t.submissionModal.viewing}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="h-3 w-3 rounded-full border border-blue-500" />
                              {t.submissionModal.unanswered}
                            </span>
                          </div>
                          <div className="grid grid-cols-5 gap-3">
                            {questions.map((question, index) => {
                              const isAnswered = answeredQuestionIds.has(question.id);
                              const isActive = currentQuestionId === question.id;
                              return (
                                <button
                                  key={question.id}
                                  type="button"
                                  onClick={() => goToQuestion(question.id)}
                                  className={cn(
                                    'flex h-11 items-center justify-center rounded-lg border text-base font-black transition',
                                    isAnswered
                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                      : isActive
                                        ? 'border-orange-400 bg-orange-50 text-orange-600'
                                        : 'border-blue-300 bg-white text-blue-600 hover:bg-blue-50'
                                  )}
                                >
                                  {index + 1}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="rounded-2xl border border-orange-100 bg-orange-50 p-5 shadow-sm">
                        <h3 className="mb-4 flex items-center gap-2 text-base font-black text-orange-700">
                          <Lightbulb className="h-5 w-5" />
                          {t.submissionModal.notes}
                        </h3>
                        <div className="grid gap-3 text-sm font-semibold text-slate-600 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                          {(isQuiz
                            ? [
                                t.submissionModal.selectOneAnswer,
                                t.submissionModal.noScreenExit,
                                t.submissionModal.autoSubmitTime,
                                t.submissionModal.checkBeforeSubmit,
                              ]
                            : [
                                t.submissionModal.fullAnswerHint,
                                t.submissionModal.neatPresentation,
                                t.submissionModal.reviewBeforeSubmit,
                              ]
                          ).map((note) => (
                            <p key={note} className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-500" />
                              {note}
                            </p>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-violet-100 bg-violet-50 p-5 shadow-sm">
                        <h3 className="mb-4 flex items-center gap-2 text-base font-black text-violet-700">
                          <Keyboard className="h-5 w-5" />
                          {t.submissionModal.shortcuts}
                        </h3>
                        <div className="grid gap-3 text-sm font-semibold text-slate-600 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                          {isQuiz && (
                            <>
                              <p className="flex items-center gap-3">
                                <span className="inline-flex gap-1">
                                  <kbd className="rounded-md bg-white px-2 py-1 shadow-sm">
                                    <ArrowLeft className="h-4 w-4" />
                                  </kbd>
                                  <kbd className="rounded-md bg-white px-2 py-1 shadow-sm">
                                    <ArrowRight className="h-4 w-4" />
                                  </kbd>
                                </span>
                                {t.submissionModal.nextQuestion}
                              </p>
                              <p className="flex items-center gap-3">
                                <kbd className="rounded-md bg-white px-2 py-1 shadow-sm">
                                  <Grid3X3 className="h-4 w-4" />
                                </kbd>
                                {t.submissionModal.viewAllQuestions}
                              </p>
                            </>
                          )}
                          {!isQuiz && (
                            <>
                              <p className="flex items-center gap-3">
                                <kbd className="rounded-md bg-white px-2 py-1 shadow-sm">
                                  Ctrl + S
                                </kbd>
                                {t.submissionModal.saveDraft}
                              </p>
                              <p className="flex items-center gap-3">
                                <kbd className="rounded-md bg-white px-2 py-1 shadow-sm">
                                  Ctrl + Z
                                </kbd>
                                {t.submissionModal.undo}
                              </p>
                            </>
                          )}
                          <p className="flex items-center gap-3">
                            <kbd className="rounded-md bg-white px-2 py-1 shadow-sm">
                              Ctrl + Enter
                            </kbd>
                            {t.submissionModal.submit}
                          </p>
                        </div>
                      </div>
                    </aside>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 text-sm font-semibold text-slate-500">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    {isQuiz ? t.submissionModal.autoSubmitTime : t.submissionModal.sentToTeacher}
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-orange-500 px-8 text-lg font-black text-white shadow-lg shadow-orange-200 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-md"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        {t.submissionModal.submitting}
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5" />
                        {t.submissionModal.submit}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </motion.div>
      </div>

      <StudentDictionaryPanel
        open={dictionaryOpen && submissionExamActive}
        onClose={() => setDictionaryOpen(false)}
      />

      <AnimatePresence>
        {integrityOverlay && submissionExamActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className={cn(
                'w-full max-w-md rounded-2xl border-2 p-6 shadow-2xl',
                integrityOverlay.kind === 'tabfocus' || integrityOverlay.kind === 'devtools'
                  ? 'border-red-500 bg-red-950 text-red-50'
                  : 'border-amber-500 bg-amber-950 text-amber-50'
              )}
            >
              <div className="mb-4 flex items-start gap-3">
                <AlertTriangle
                  className={cn(
                    'h-10 w-10 shrink-0',
                    integrityOverlay.kind === 'tabfocus' || integrityOverlay.kind === 'devtools'
                      ? 'text-red-400'
                      : 'text-amber-400'
                  )}
                />
                <div>
                  <h3 className="text-lg font-bold leading-tight">
                    {integrityOverlay.kind === 'devtools'
                      ? t.submissionModal.devtoolsWarningTitle
                      : integrityOverlay.kind === 'tabfocus'
                        ? t.submissionModal.warningTitle
                        : t.submissionModal.fullscreenWarningTitle}
                  </h3>
                  {integrityOverlay.kind === 'devtools' ? (
                    <p className="mt-2 text-sm leading-relaxed text-red-100/95">
                      {t.submissionModal.devtoolsWarning
                        .replace('{total}', String(integrityOverlay.total))
                        .replace('{limit}', String(INTEGRITY_TAB_FOCUS_AUTO_SUBMIT))
                        .replace('{count}', String(integrityOverlay.total))
                        .replace('{max}', String(INTEGRITY_TAB_FOCUS_AUTO_SUBMIT))}
                    </p>
                  ) : integrityOverlay.kind === 'tabfocus' ? (
                    <p className="mt-2 text-sm leading-relaxed text-red-100/95">
                      {t.submissionModal.tabFocusWarning
                        .replace('{total}', String(integrityOverlay.total))
                        .replace('{limit}', String(INTEGRITY_TAB_FOCUS_AUTO_SUBMIT))
                        .replace('{count}', String(integrityOverlay.total))
                        .replace('{max}', String(INTEGRITY_TAB_FOCUS_AUTO_SUBMIT))}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm leading-relaxed text-amber-100/95">
                      {t.submissionModal.fullscreenWarning
                        .replace('{count}', String(integrityOverlay.exitCount))
                        .replace('{limit}', String(INTEGRITY_FULLSCREEN_AUTO_SUBMIT))
                        .replace('{max}', String(INTEGRITY_FULLSCREEN_AUTO_SUBMIT))}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIntegrityOverlay(null)}
                className={cn(
                  'w-full rounded-xl py-3 text-sm font-semibold text-white transition-colors',
                  integrityOverlay.kind === 'tabfocus' || integrityOverlay.kind === 'devtools'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                )}
              >
                {t.submissionModal.understood}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return createPortal(modalContent, document.body);
}
