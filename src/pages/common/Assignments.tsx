import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { apiRequest } from '../../lib/api/apiClient';
import { readChannel } from '../../lib/api/readApi';
import { usePollingStream } from '../../hooks/usePollingStream';
import { LoadMore, useClientPagination } from '../../components/common/LoadMore';
import { FRONTEND_COLLECTION_LIMIT } from '../../lib/api/readLimits';
import {
  Plus,
  ClipboardList,
  Send,
  CheckCircle,
  Clock,
  Users,
  Calendar,
  X,
  Edit2,
  Trash2,
  Check,
  MessageSquare,
  Archive,
  Loader2,
} from 'lucide-react';
import { AssignmentModal } from '../../components/assignments/AssignmentModal';
import { SubmissionModal } from '../../components/assignments/SubmissionModal';
import { GradingModal } from '../../components/assignments/GradingModal';
import { StudentSubmissionReviewModal } from '../../components/assignments/StudentSubmissionReviewModal';
import { NotifyMissingAssignmentModal } from '../../components/assignments/NotifyMissingAssignmentModal';
import { AssignmentOperationsPanel } from '../../components/assignments/AssignmentOperationsPanel';
import { AssessmentBuilder } from '../../components/assignments/assessmentBuilder/AssessmentBuilder';
import { useAssignmentAttemptAutosave } from '../../components/assignments/attempt/useAssignmentAttemptAutosave';
import type { buildAdvancedAssignmentPayload } from '../../components/assignments/assessmentBuilder/assessmentBuilderState';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import {
  Assignment,
  Submission,
  Class,
  UserProfile,
  Student,
  QuizQuestion,
  QuizAnswer,
  ExamIntegrityPayload,
  ExamAutoSubmitReason,
} from '../../types';
import { useExamAntiCheat } from '../../hooks/useExamAntiCheat';
import { readClassesData, readOfficeAcademicReferences } from '../../lib/api/frontendReadApi';
import { BLOCK_DEV_TOOL_ATTEMPT_EVENT } from '../../hooks/useBlockDevToolGuard';
import { SubmissionsList } from '../../components/assignments/SubmissionsList';
import { formatVN, apiDateTimeToDisplayDateTime, userDateTimeToApiIso } from '../../lib/core/utils';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../shared/classVisibility';
import {
  DEFAULT_ASSIGNMENT_PROCTORING_MODE,
  normalizeAssignmentProctoringMode,
} from '../../../shared/assignmentProctoring';
import {
  canStudentAccessAssignment,
  canStudentReviewAssignmentResults,
} from '../../../shared/assignmentDelivery';
import type {
  AssessmentAnswer,
  AssessmentQuestionGradeInput,
} from '../../../shared/assignmentAssessment';
import { getAssessmentProgress } from '../../../shared/assignmentAssessment';
import { deleteAuthoringDraft, listAuthoringDrafts } from '../../lib/api/assignmentAuthoringApi';
import { AuthoringDraftList } from '../../components/assignments/authoring/AuthoringDraftList';
import {
  clearLocalDraft,
  isDraftNewer,
  listLocalDrafts,
  loadLocalDraft,
} from '../../components/assignments/authoring/draftSync';
import type { AssignmentAuthoringDraft } from '../../../shared/assignmentAuthoring';

const INTEGRITY_TAB_FOCUS_WARN = 3;
const INTEGRITY_TAB_FOCUS_AUTO_SUBMIT = 5;
const INTEGRITY_FULLSCREEN_AUTO_SUBMIT = 3;
const ARCHIVE_DAYS_THRESHOLD = 7;

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 25 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 350, damping: 25 } },
};

function isAssignmentArchived(dueDate: string): boolean {
  if (!dueDate) return false;
  const diffMs = Date.now() - new Date(dueDate).getTime();
  return diffMs > ARCHIVE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
}

interface AssignmentsProps {
  profile: UserProfile | null;
}

const SubmissionCount = ({ count }: { count: number }) => {
  const { t } = useLanguage();
  const T = t.pageAssignments;

  return (
    <div className="flex items-center text-xs font-medium px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600">
      <Users className="w-3 h-3 mr-1" />
      {T.submissionsCount.replace('{count}', count.toString())}
    </div>
  );
};

function authoringDraftTimestamp(draft: AssignmentAuthoringDraft) {
  const timestamp = Date.parse(draft.updatedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeAuthoringDrafts(
  serverDrafts: AssignmentAuthoringDraft[],
  localDrafts: AssignmentAuthoringDraft[],
  teacherUid: string
) {
  const merged = new Map(serverDrafts.map((draft) => [draft.id, draft]));
  for (const localDraft of localDrafts) {
    if (localDraft.ownerUid !== teacherUid || localDraft.status !== 'draft') continue;
    const serverDraft = merged.get(localDraft.id);
    if (!serverDraft || isDraftNewer(localDraft, serverDraft)) {
      merged.set(localDraft.id, localDraft);
    }
  }
  return Array.from(merged.values()).sort(
    (left, right) => authoringDraftTimestamp(right) - authoringDraftTimestamp(left)
  );
}

export default function Assignments({ profile }: AssignmentsProps) {
  const { t, language } = useLanguage();
  const T = t.pageAssignments;
  const navigate = useNavigate();

  const cachedDataRef = useRef<{
    promise: Promise<{
      assignments: Assignment[];
      submissions: Submission[];
      serverTime: number;
    }> | null;
  }>({ promise: null });

  // Clear cache promise when profile changes to ensure fresh data
  useEffect(() => {
    cachedDataRef.current.promise = null;
  }, [profile]);

  const fetchSharedData = useCallback(() => {
    if (!cachedDataRef.current.promise) {
      const request = readChannel<{
        assignments: Assignment[];
        submissions: Submission[];
        serverTime: number;
      }>('assignments');
      cachedDataRef.current.promise = request;
      void request.finally(() => {
        if (cachedDataRef.current.promise === request) {
          cachedDataRef.current.promise = null;
        }
      });
    }
    return cachedDataRef.current.promise;
  }, []);

  const fetchAssignments = useCallback(async () => {
    const data = await fetchSharedData();
    return {
      items: data.assignments || [],
      serverTime: data.serverTime,
    };
  }, [fetchSharedData]);

  const fetchSubmissions = useCallback(async () => {
    const data = await fetchSharedData();
    return {
      items: data.submissions || [],
      serverTime: data.serverTime,
    };
  }, [fetchSharedData]);

  const { data: assignments, loading: assignmentsLoading } = usePollingStream<Assignment>({
    topic: 'assignments',
    fetchInitialData: fetchAssignments,
    enabled: !!profile,
  });

  const { data: submissions, loading: submissionsLoading } = usePollingStream<Submission>({
    topic: 'submissions',
    fetchInitialData: fetchSubmissions,
    enabled: !!profile,
  });

  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<{ uid: string; displayName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssessmentBuilderOpen, setIsAssessmentBuilderOpen] = useState(false);
  const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);
  const [submissionExamActive, setSubmissionExamActive] = useState(false);
  const [integrityOverlay, setIntegrityOverlay] = useState<
    | null
    | { kind: 'tabfocus'; total: number }
    | { kind: 'fullscreen'; exitCount: number }
    | { kind: 'devtools'; total: number }
  >(null);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);

  const integritySuspendRef = useRef(false);
  const prevTabFocusCombinedRef = useRef(0);
  const prevFullscreenExitRef = useRef(0);
  const pendingDevToolsFocusLossRef = useRef(0);
  const autoSubmitTriggeredRef = useRef(false);
  const [isGradingModalOpen, setIsGradingModalOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [selectedReviewSubmission, setSelectedReviewSubmission] = useState<Submission | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [selectedFilterClassId, setSelectedFilterClassId] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [notifyMissingAssignment, setNotifyMissingAssignment] = useState<Assignment | null>(null);
  const [sendingNotificationId, setSendingNotificationId] = useState<string | null>(null);
  const [operationsAssignmentId, setOperationsAssignmentId] = useState<string | null>(null);
  const [authoringDrafts, setAuthoringDrafts] = useState<AssignmentAuthoringDraft[]>([]);
  const [authoringDraftsLoading, setAuthoringDraftsLoading] = useState(false);
  const [authoringDraftsError, setAuthoringDraftsError] = useState('');

  const loadAuthoringDrafts = useCallback(async () => {
    if (profile?.role !== 'teacher') return;
    setAuthoringDraftsLoading(true);
    setAuthoringDraftsError('');
    try {
      const drafts = await listAuthoringDrafts<AssignmentAuthoringDraft>();
      setAuthoringDrafts(mergeAuthoringDrafts(drafts, listLocalDrafts(), profile.uid));
    } catch (err) {
      console.error('Error loading advanced assignment drafts:', err);
      setAuthoringDraftsError(T.advancedDrafts.loadError);
    } finally {
      setAuthoringDraftsLoading(false);
    }
  }, [T.advancedDrafts.loadError, profile?.role, profile?.uid]);

  useEffect(() => {
    void loadAuthoringDrafts();
  }, [loadAuthoringDrafts]);

  const handleDeleteAuthoringDraft = async (draftId: string) => {
    if (!window.confirm(T.advancedDrafts.deleteConfirm)) return;
    try {
      const draft = authoringDrafts.find((item) => item.id === draftId);
      const localDraft = loadLocalDraft(draftId);
      if (localDraft && Number(draft?.serverRevision || 0) <= 0) {
        clearLocalDraft(draftId);
        setAuthoringDrafts((drafts) => drafts.filter((item) => item.id !== draftId));
        return;
      }
      await deleteAuthoringDraft(draftId);
      clearLocalDraft(draftId);
      setAuthoringDrafts((drafts) => drafts.filter((draft) => draft.id !== draftId));
    } catch (err) {
      console.error('Error deleting advanced assignment draft:', err);
      setError(T.advancedDrafts.deleteError);
    }
  };

  const handleSendNotification = async (
    studentId: string,
    title: string,
    message: string,
    type: 'absence' | 'missing_assignment' | 'general' | 'behavior' | 'praise',
    classId?: string
  ) => {
    try {
      setSendingNotificationId(studentId);
      await apiRequest('/api/v1/messages/send-notification', {
        method: 'POST',
        body: { studentId, title, message, type, classId: classId || '' },
      });
      showSuccess(t.dashboard.teacher.notifSuccess);
    } catch (error) {
      console.error('Error sending notification:', error);
      setError(t.dashboard.teacher.notifError);
    } finally {
      setSendingNotificationId(null);
    }
  };

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    dueDate: '',
    classId: '',
    type: 'essay' as 'essay' | 'quiz',
    questions: [] as QuizQuestion[],
    attemptsAllowed: 1,
    proctoringMode: DEFAULT_ASSIGNMENT_PROCTORING_MODE,
  });

  const [jsonInput, setJsonInput] = useState('');
  const [quizAnswers, setQuizAnswers] = useState<QuizAnswer[]>([]);
  const [assessmentAnswers, setAssessmentAnswers] = useState<AssessmentAnswer[]>([]);
  const devToolsAttemptStateRef = useRef({
    isSubmissionModalOpen: false,
    submissionExamActive: false,
    hasSelectedAssignment: false,
    isStudent: false,
    isStrictSubmissionMode: false,
    tabSwitchCount: 0,
    focusLossCount: 0,
  });

  const [submissionData, setSubmissionData] = useState({
    content: '',
  });

  const [gradingData, setGradingData] = useState({
    grade: '',
    feedback: '',
  });

  const isTeacher = profile?.role === 'teacher';
  const isStudent = profile?.role === 'student';
  const isAdmin = profile?.role === 'admin';

  const selectedProctoringMode = normalizeAssignmentProctoringMode(
    selectedAssignment?.proctoringMode
  );
  const isStrictSubmissionMode = selectedProctoringMode === 'strict';

  const {
    metrics: examMetrics,
    enterFullscreen,
    exitFullscreenSafe,
    recordFocusLoss,
    getIntegrityForSubmit,
  } = useExamAntiCheat(
    isSubmissionModalOpen && submissionExamActive && isStudent && isStrictSubmissionMode,
    integritySuspendRef
  );

  devToolsAttemptStateRef.current = {
    isSubmissionModalOpen,
    submissionExamActive,
    hasSelectedAssignment: Boolean(selectedAssignment),
    isStudent,
    isStrictSubmissionMode,
    tabSwitchCount: examMetrics.tabSwitchCount,
    focusLossCount: examMetrics.focusLossCount,
  };

  const attemptAutosave = useAssignmentAttemptAutosave({
    enabled: Boolean(
      isSubmissionModalOpen && submissionExamActive && isStudent && selectedAssignment
    ),
    assignmentId: selectedAssignment?.id || null,
    studentId: profile?.studentId || null,
    content: submissionData.content,
    quizAnswers,
    assessmentAnswers,
    onHydrate: (draft) => {
      setSubmissionData({ content: String(draft.content || '') });
      setQuizAnswers(Array.isArray(draft.quizAnswers) ? (draft.quizAnswers as QuizAnswer[]) : []);
      setAssessmentAnswers(
        Array.isArray(draft.assessmentAnswers)
          ? (draft.assessmentAnswers as AssessmentAnswer[])
          : []
      );
    },
  });

  const endExamSession = useCallback(async () => {
    integritySuspendRef.current = true;
    try {
      await exitFullscreenSafe();
    } finally {
      setSubmissionExamActive(false);
      integritySuspendRef.current = false;
    }
  }, [exitFullscreenSafe]);

  const closeSubmissionModal = useCallback(async () => {
    await endExamSession();
    setDictionaryOpen(false);
    setIsSubmissionModalOpen(false);
    setSubmissionData({ content: '' });
    setQuizAnswers([]);
    setAssessmentAnswers([]);
    setSelectedAssignment(null);
  }, [endExamSession]);

  const submitStudentAssignment = useCallback(
    async (integrityExtra?: Partial<ExamIntegrityPayload>) => {
      if (!profile || !selectedAssignment || !profile.studentId || !profile.classId) return false;

      const isAssessmentV2 = selectedAssignment.assessment?.version === 2;
      const submissionPayload: Record<string, unknown> = {
        assignmentId: selectedAssignment.id,
        studentId: profile.studentId,
        teacherId: selectedAssignment.teacherId,
        classId: profile.classId,
        content: selectedAssignment.type !== 'quiz' ? submissionData.content : '',
        quizAnswers: selectedAssignment.type === 'quiz' && !isAssessmentV2 ? quizAnswers : [],
        assessmentAnswers: isAssessmentV2 ? assessmentAnswers : [],
        submittedAt: new Date().toISOString(),
        attemptNumber:
          (submissions.filter(
            (s) => s.assignmentId === selectedAssignment.id && s.studentId === profile.studentId
          ).length || 0) + 1,
        examIntegrity: isStrictSubmissionMode
          ? {
              ...getIntegrityForSubmit(),
              ...integrityExtra,
            }
          : null,
      };

      await apiRequest('/api/v1/edu/assignment-submit', {
        method: 'POST',
        body: submissionPayload,
      });
      return true;
    },
    [
      profile,
      selectedAssignment,
      quizAnswers,
      assessmentAnswers,
      submissionData,
      submissions,
      getIntegrityForSubmit,
      isStrictSubmissionMode,
    ]
  );

  const performAutoSubmit = useCallback(
    async (reason: ExamAutoSubmitReason) => {
      if (import.meta.env.DEV) console.log('AntiCheat: Performing auto-submit for reason:', reason);
      await submitStudentAssignment({
        autoSubmitted: true,
        autoSubmitReason: reason,
      });
      await attemptAutosave.clearDraft();
      await closeSubmissionModal();
    },
    [submitStudentAssignment, attemptAutosave, closeSubmissionModal]
  );

  const handleStartExamSession = async () => {
    if (!isStrictSubmissionMode) {
      setSubmissionExamActive(true);
      return;
    }

    const ok = await enterFullscreen();
    if (!ok) {
      const proceed = window.confirm(T.fullscreenNotSupported);
      if (!proceed) return;
    }
    setSubmissionExamActive(true);
  };

  useEffect(() => {
    if (submissionExamActive && isStudent) {
      prevTabFocusCombinedRef.current = 0;
      prevFullscreenExitRef.current = 0;
      autoSubmitTriggeredRef.current = false;
      setIntegrityOverlay(null);
    }
  }, [submissionExamActive, isStudent]);

  useEffect(() => {
    if (!submissionExamActive || !selectedAssignment || !isStudent || !isStrictSubmissionMode)
      return;
    if (integritySuspendRef.current) return;

    const combined = examMetrics.tabSwitchCount + examMetrics.focusLossCount;
    const fs = examMetrics.fullscreenExitCount;
    const prevC = prevTabFocusCombinedRef.current;
    const prevF = prevFullscreenExitRef.current;
    const pendingDevToolsFocusLoss = pendingDevToolsFocusLossRef.current;
    const combinedDelta = Math.max(0, combined - prevC);
    const devToolsFocusDelta = Math.min(pendingDevToolsFocusLoss, combinedDelta);
    const shouldKeepDevToolsOverlay = devToolsFocusDelta > 0;

    if (import.meta.env.DEV)
      console.log('AntiCheat Debug:', {
        combined,
        fs,
        prevC,
        prevF,
        autoSubmitTriggered: autoSubmitTriggeredRef.current,
      });

    if (
      fs >= INTEGRITY_FULLSCREEN_AUTO_SUBMIT &&
      prevF < INTEGRITY_FULLSCREEN_AUTO_SUBMIT &&
      !autoSubmitTriggeredRef.current
    ) {
      autoSubmitTriggeredRef.current = true;
      prevTabFocusCombinedRef.current = combined;
      prevFullscreenExitRef.current = fs;
      void performAutoSubmit('fullscreen_exit_limit').catch((err) => {
        console.error('Auto-submit failed:', err);
        autoSubmitTriggeredRef.current = false;
        prevFullscreenExitRef.current = prevF;
      });
      return;
    }

    if (
      combined >= INTEGRITY_TAB_FOCUS_AUTO_SUBMIT &&
      prevC < INTEGRITY_TAB_FOCUS_AUTO_SUBMIT &&
      !autoSubmitTriggeredRef.current
    ) {
      autoSubmitTriggeredRef.current = true;
      prevTabFocusCombinedRef.current = combined;
      prevFullscreenExitRef.current = fs;
      void performAutoSubmit('tab_focus_limit').catch((err) => {
        console.error('Auto-submit failed:', err);
        autoSubmitTriggeredRef.current = false;
        prevTabFocusCombinedRef.current = prevC;
      });
      return;
    }

    if (fs > prevF && fs > 0 && fs < INTEGRITY_FULLSCREEN_AUTO_SUBMIT) {
      setIntegrityOverlay({ kind: 'fullscreen', exitCount: fs });
    } else if (
      combined >= INTEGRITY_TAB_FOCUS_WARN &&
      combined < INTEGRITY_TAB_FOCUS_AUTO_SUBMIT &&
      combined > prevC &&
      !shouldKeepDevToolsOverlay
    ) {
      setIntegrityOverlay({ kind: 'tabfocus', total: combined });
    }

    if (devToolsFocusDelta > 0) {
      pendingDevToolsFocusLossRef.current = Math.max(
        0,
        pendingDevToolsFocusLossRef.current - devToolsFocusDelta
      );
    }
    prevTabFocusCombinedRef.current = combined;
    prevFullscreenExitRef.current = fs;
  }, [
    examMetrics.tabSwitchCount,
    examMetrics.focusLossCount,
    examMetrics.fullscreenExitCount,
    submissionExamActive,
    selectedAssignment,
    isStudent,
    performAutoSubmit,
    isStrictSubmissionMode,
  ]);

  useEffect(() => {
    const handleDevToolsAttempt = (event: Event) => {
      const state = devToolsAttemptStateRef.current;
      if (
        !state.isSubmissionModalOpen ||
        !state.submissionExamActive ||
        !state.hasSelectedAssignment ||
        !state.isStudent ||
        !state.isStrictSubmissionMode
      ) {
        return;
      }

      event.preventDefault();
      pendingDevToolsFocusLossRef.current += 1;
      recordFocusLoss();
      const nextTotal =
        state.tabSwitchCount + state.focusLossCount + pendingDevToolsFocusLossRef.current;
      setIntegrityOverlay({ kind: 'devtools', total: nextTotal });
    };

    window.addEventListener(BLOCK_DEV_TOOL_ATTEMPT_EVENT, handleDevToolsAttempt);
    return () => window.removeEventListener(BLOCK_DEV_TOOL_ATTEMPT_EVENT, handleDevToolsAttempt);
  }, [recordFocusLoss]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    if (isTeacher || isAdmin) {
      readClassesData()
        .then((data) => {
          if (cancelled) return;
          setClasses(filterClassesForRoleOutsideAdminDashboard(data.classes || [], profile.role));
        })
        .catch((err) => console.error('Error fetching classes through read API:', err));

      readChannel<{ students: Student[] }>('students', {
        view: 'academic',
        limit: FRONTEND_COLLECTION_LIMIT,
        })
        .then((data) => {
          if (!cancelled) setStudents(data.students || []);
        })
        .catch((err) => {
          console.error('Error fetching students:', err);
        });

      const hasTeachersAccess =
        isAdmin || profile?.role === 'office' || profile?.role === 'accounting';
      if (hasTeachersAccess) {
        readOfficeAcademicReferences()
          .then((data) => {
            if (!cancelled) setTeachers(data.teachers || []);
          })
          .catch((err) => console.error('Error fetching teacher references:', err));
      } else if (isTeacher) {
        setTeachers([
          {
            uid: profile.uid,
            displayName: profile.displayName || profile.email || 'GV',
          },
        ]);
      }

      return () => {
        cancelled = true;
      };
    } else if (isStudent && profile.classId) {
      // Fetch student's own class via server read API
      readChannel<{ classes: Class[] }>('classes', {
        limit: FRONTEND_COLLECTION_LIMIT,
      })
        .then((data) => {
          if (!cancelled) {
            setClasses(filterClassesForRoleOutsideAdminDashboard(data.classes || [], profile.role));
          }
        })
        .catch((err) => {
          console.error('Error fetching student classes:', err);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [profile, isTeacher, isStudent]);

  useEffect(() => {
    if (!assignmentsLoading && !submissionsLoading) {
      setLoading(false);
    }
  }, [assignmentsLoading, submissionsLoading]);

  const [isSaving, setIsSaving] = useState(false);

  const showSuccess = (msg: string) => {
    toast.success(msg);
  };

  const setError = (msg: string | null) => {
    if (msg) toast.error(msg);
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || isSaving) return;

    if (!formData.dueDate) {
      setError(T.messages.requireDueDate);
      return;
    }

    if (formData.type === 'quiz' && formData.questions.length === 0) {
      setError(T.messages.requireQuestions);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const dueDateForApi = userDateTimeToApiIso(formData.dueDate);
      const assignmentData = {
        title: formData.title,
        description: formData.description,
        dueDate: dueDateForApi,
        classId: formData.classId,
        type: formData.type,
        questions: formData.type === 'quiz' ? formData.questions : [],
        attemptsAllowed: formData.attemptsAllowed || 1,
        proctoringMode: normalizeAssignmentProctoringMode(formData.proctoringMode),
      };

      if (editingAssignment) {
        await apiRequest('/api/v1/edu/assignment-update', {
          method: 'PUT',
          body: { id: editingAssignment.id, ...assignmentData },
        });
        showSuccess(T.messages.updateSuccess);
      } else {
        await apiRequest('/api/v1/edu/assignment-create', {
          method: 'POST',
          body: assignmentData,
        });
        showSuccess(T.messages.createSuccess);
      }
      setIsModalOpen(false);
      setEditingAssignment(null);
      setFormData({
        title: '',
        description: '',
        dueDate: '',
        classId: '',
        type: 'essay',
        questions: [],
        attemptsAllowed: 1,
        proctoringMode: DEFAULT_ASSIGNMENT_PROCTORING_MODE,
      });
      setJsonInput('');
    } catch (err) {
      console.error('Error saving assignment:', err);
      setError(T.messages.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAdvancedAssignment = async (
    assignmentData: ReturnType<typeof buildAdvancedAssignmentPayload>
  ) => {
    if (!profile || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      await apiRequest('/api/v1/edu/assignment-create', {
        method: 'POST',
        body: assignmentData,
      });
      showSuccess(T.messages.createSuccess);
      setIsAssessmentBuilderOpen(false);
    } catch (err) {
      console.error('Error saving advanced assignment:', err);
      setError(T.messages.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (!Array.isArray(parsed)) {
        toast.error(T.messages.invalidJsonArray);
        return;
      }

      // Basic validation
      const isValid = parsed.every(
        (q) =>
          q.question_content &&
          Array.isArray(q.options) &&
          q.correct_answer &&
          q.options.length >= 2
      );

      if (!isValid) {
        toast.error(T.messages.invalidJsonStructure);
        return;
      }

      setFormData({ ...formData, questions: parsed });
      setJsonInput('');
      toast.success(T.messages.importSuccess.replace('{count}', parsed.length.toString()));
    } catch (e) {
      toast.error(T.messages.invalidJson);
    }
  };

  const handleAddQuestion = () => {
    const newQuestion: QuizQuestion = {
      id: Date.now(),
      question_content: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
        { key: 'D', text: '' },
      ],
      correct_answer: 'A',
      level: T.difficultyEasy,
    };
    setFormData({ ...formData, questions: [...formData.questions, newQuestion] });
  };

  const handleUpdateQuestion = (id: number, updates: Partial<QuizQuestion>) => {
    setFormData({
      ...formData,
      questions: formData.questions.map((q) => (q.id === id ? { ...q, ...updates } : q)),
    });
  };

  const handleRemoveQuestion = (id: number) => {
    setFormData({
      ...formData,
      questions: formData.questions.filter((q) => q.id !== id),
    });
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedAssignment || !profile.studentId || !profile.classId || isSubmitting)
      return;

    if (selectedAssignment.type !== 'quiz' && !submissionData.content.trim()) {
      toast.error(T.messages.requireAnswerContent);
      return;
    }

    if (selectedAssignment.assessment?.version === 2) {
      const progress = getAssessmentProgress(selectedAssignment.assessment, assessmentAnswers);
      if (progress.answered < progress.total && !window.confirm(T.submitConfirm)) {
        return;
      }
    }

    if (
      selectedAssignment.type === 'quiz' &&
      selectedAssignment.assessment?.version !== 2 &&
      quizAnswers.length < (selectedAssignment.questions?.length || 0)
    ) {
      if (!window.confirm(T.submitConfirm)) {
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await submitStudentAssignment();
      await attemptAutosave.clearDraft();
      await closeSubmissionModal();
      showSuccess(T.messages.submitSuccess);
    } catch (err) {
      console.error('Error submitting assignment:', err);
      setError(T.messages.submitError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isGrading, setIsGrading] = useState(false);

  const handleGradeSubmission = async (
    e: React.FormEvent,
    payload?: { assessmentQuestionScores?: AssessmentQuestionGradeInput[] }
  ) => {
    e.preventDefault();
    if (!selectedSubmission || isGrading) return;

    setIsGrading(true);
    setError(null);

    try {
      const body =
        payload?.assessmentQuestionScores !== undefined
          ? {
              submissionId: selectedSubmission.id,
              assessmentQuestionScores: payload.assessmentQuestionScores,
              feedback: gradingData.feedback,
            }
          : {
              submissionId: selectedSubmission.id,
              grade: Number(gradingData.grade),
              feedback: gradingData.feedback,
            };

      await apiRequest('/api/v1/edu/assignment-grade', {
        method: 'POST',
        body,
      });
      setIsGradingModalOpen(false);
      setGradingData({ grade: '', feedback: '' });
      setSelectedSubmission(null);
      showSuccess(T.messages.gradeSuccess);
    } catch (err) {
      console.error('Error grading submission:', err);
      setError(T.messages.gradeError);
    } finally {
      setIsGrading(false);
    }
  };

  const [deletingAssignmentId, setDeletingAssignmentId] = useState<string | null>(null);

  const handleDeleteAssignment = async (id: string) => {
    if (deletingAssignmentId || !profile || !window.confirm(T.deleteConfirm)) return;
    setDeletingAssignmentId(id);
    setError(null);

    try {
      await apiRequest('/api/v1/edu/assignment-delete', {
        method: 'DELETE',
        body: { id },
      });

      showSuccess(T.messages.deleteSuccess);
    } catch (err) {
      console.error('Error deleting assignment:', err);
      setError(T.messages.deleteError);
    } finally {
      setDeletingAssignmentId(null);
    }
  };

  const getStudentSubmission = (assignmentId: string) => {
    return submissions.find((s) => s.assignmentId === assignmentId);
  };

  const getAssignmentSubmissions = (assignmentId: string) => {
    return submissions.filter((s) => s.assignmentId === assignmentId);
  };

  const getStudentName = (studentId: string) => {
    return students.find((s) => s.id === studentId)?.name || 'Unknown Student';
  };

  const getClassName = (classId: string) => {
    return classes.find((c) => c.id === classId)?.name || 'Unknown Class';
  };
  const sortedClasses = useMemo(
    () => sortClassesByTeacherThenName(classes, teachers),
    [classes, teachers]
  );

  // Step 1: Class filter
  const classFilteredAssignments = useMemo(
    () =>
      assignments
        .filter((a) => !selectedFilterClassId || a.classId === selectedFilterClassId)
        .filter((assignment) => {
          if (!isStudent || !profile?.classId || !profile?.studentId) return true;
          return canStudentAccessAssignment(
            { classId: assignment.classId, deliveryPolicy: assignment.deliveryPolicy },
            { classId: profile.classId, studentId: profile.studentId }
          );
        }),
    [assignments, selectedFilterClassId, isStudent, profile?.classId, profile?.studentId]
  );

  // Step 2: Split into active / archived
  const activeAssignments = useMemo(
    () => classFilteredAssignments.filter((a) => !isAssignmentArchived(a.dueDate)),
    [classFilteredAssignments]
  );
  const archivedAssignments = useMemo(
    () => classFilteredAssignments.filter((a) => isAssignmentArchived(a.dueDate)),
    [classFilteredAssignments]
  );

  // Step 3: Select view
  const viewAssignments = showArchived ? archivedAssignments : activeAssignments;

  // Step 4: Paginate
  const {
    shownItems: paginatedAssignments,
    hasMore: hasMoreAssignments,
    loadMore: loadMoreAssignments,
    totalShown: assignmentsShown,
    totalAvailable: assignmentsTotal,
  } = useClientPagination(viewAssignments, 12);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-heading">{T.title}</h1>
          <p className="text-muted">
            {isAdmin ? T.adminDesc : isTeacher ? T.subtitle : T.studentDesc}
          </p>
        </div>
        {(isTeacher || isAdmin) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => {
                setEditingAssignment(null);
                setFormData({
                  title: '',
                  description: '',
                  dueDate: '',
                  classId: '',
                  type: 'essay',
                  questions: [],
                  attemptsAllowed: 1,
                  proctoringMode: DEFAULT_ASSIGNMENT_PROCTORING_MODE,
                });
                setIsModalOpen(true);
              }}
              className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 dark:shadow-blue-900/30"
            >
              <Plus className="w-4 h-4" />
              <span>{T.addAssignment}</span>
            </button>
            {profile?.role === 'teacher' && (
              <button
                type="button"
                onClick={() => navigate('/assignments/advanced/new')}
                className="flex items-center justify-center space-x-2 border border-blue-200 bg-white text-blue-700 px-4 py-2 rounded-lg font-medium hover:bg-blue-50 transition-colors dark:border-blue-500/30 dark:bg-slate-800 dark:text-blue-300"
              >
                <Plus className="w-4 h-4" />
                <span>{T.addAdvancedAssignment}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {profile?.role === 'teacher' && (
        <AuthoringDraftList
          drafts={authoringDrafts}
          classes={classes.map((classItem) => ({ id: classItem.id, name: classItem.name }))}
          loading={authoringDraftsLoading}
          error={authoringDraftsError}
          labels={T.advancedDrafts}
          onOpen={(draftId) => navigate(`/assignments/advanced/${draftId}`)}
          onDelete={(draftId) => {
            void handleDeleteAuthoringDraft(draftId);
          }}
          onRetry={() => {
            void loadAuthoringDrafts();
          }}
        />
      )}

      {/* Active / Archived toggle */}
      <div className="flex items-center gap-1 p-1 bg-surface rounded-xl border border-border-default w-fit">
        <button
          onClick={() => setShowArchived(false)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            !showArchived
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-subtle hover:text-heading hover:bg-hover'
          )}
        >
          {T.activeAssignments}
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            showArchived
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-subtle hover:text-heading hover:bg-hover'
          )}
        >
          {T.archivedAssignments}{' '}
          <span
            className={cn(
              'ml-1 text-xs px-1.5 py-0.5 rounded-full',
              showArchived
                ? 'bg-white/20 text-white'
                : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
            )}
          >
            {archivedAssignments.length}
          </span>
        </button>
      </div>

      {(isTeacher || isAdmin) && (
        <div className="flex flex-wrap items-center gap-4 bg-surface p-4 rounded-2xl border border-border-default shadow-sm dark:shadow-black/20">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-muted">
              <Users className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {T.filterByClass}
            </span>
          </div>
          <select
            value={selectedFilterClassId}
            onChange={(e) => setSelectedFilterClassId(e.target.value)}
            className="flex-1 sm:flex-none min-w-[200px] px-4 py-2 bg-page border border-border-default rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 transition-all outline-none"
          >
            <option value="">{T.allClasses}</option>
            {sortedClasses.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {formatClassNameWithTeacher(cls, teachers)}
              </option>
            ))}
          </select>
        </div>
      )}

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {viewAssignments.length > 0 ? (
          paginatedAssignments.map((assignment) => {
            const studentSubmissions = isStudent
              ? submissions.filter(
                  (s) => s.assignmentId === assignment.id && s.studentId === profile?.studentId
                )
              : [];
            const submission = studentSubmissions.sort(
              (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
            )[0];
            const isPastDue = new Date(assignment.dueDate) < new Date();
            const isOverdue = isPastDue && !submission;
            const attemptsMade = studentSubmissions.length;
            const attemptsAllowed = assignment.attemptsAllowed || 1;
            const canAttempt = isStudent && attemptsMade < attemptsAllowed && !isPastDue;
            const isBeforeAvailable =
              assignment.deliveryPolicy?.availableFrom &&
              new Date(assignment.deliveryPolicy.availableFrom) > new Date();

            return (
              <motion.div
                layout
                key={assignment.id}
                variants={itemVariants}
                whileHover={{
                  y: -5,
                  scale: 1.012,
                  boxShadow: '0 20px 40px rgba(59, 130, 246, 0.08)',
                  transition: { type: 'spring', stiffness: 450, damping: 24 },
                }}
                className="bg-surface dark:bg-slate-800 rounded-2xl border border-border-default dark:border-slate-700/50 overflow-hidden relative group transition-colors duration-200 cursor-default"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-50 dark:bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-600">
                        <ClipboardList className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-heading">{assignment.title}</h3>
                        <p className="text-xs text-muted">
                          {T.classPrefix}
                          {getClassName(assignment.classId)}
                          {isAdmin &&
                            ` • GV: ${teachers.find((t) => t.uid === assignment.teacherId)?.displayName || 'Unknown'}`}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {isAssignmentArchived(assignment.dueDate) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-400 px-2 py-0.5 rounded-full">
                              <Archive className="w-3 h-3" />
                              {T.archivedBadge}
                            </span>
                          )}
                          {assignment.deliveryPolicy?.availableFrom &&
                            new Date(assignment.deliveryPolicy.availableFrom) > new Date() && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400 px-2 py-0.5 rounded-full">
                                {language === 'vi' ? 'Đã lên lịch' : 'Scheduled'}
                              </span>
                            )}
                          {assignment.deliveryPolicy?.targetMode === 'selected_students' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400 px-2 py-0.5 rounded-full">
                              {language === 'vi' ? 'Học sinh được chọn' : 'Selected students'}
                            </span>
                          )}
                          {assignment.deliveryPolicy?.resultReleasePolicy === 'after_due' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 dark:bg-purple-500/10 dark:text-purple-400 px-2 py-0.5 rounded-full">
                              {language === 'vi'
                                ? 'Xem đáp án sau hạn nộp'
                                : 'Answers after due date'}
                            </span>
                          )}
                          {assignment.deliveryPolicy?.resultReleasePolicy === 'manual' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400 px-2 py-0.5 rounded-full">
                              {language === 'vi' ? 'Giải phóng điểm thủ công' : 'Manual release'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {(isTeacher || isAdmin) && (
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setOperationsAssignmentId(assignment.id)}
                          className="px-2 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200 dark:border-blue-800"
                        >
                          Operations
                        </button>
                        <button
                          onClick={() => setNotifyMissingAssignment(assignment)}
                          className="p-2 text-subtle hover:text-blue-600 hover:bg-blue-50 dark:bg-blue-500/10 rounded-lg transition-colors"
                          title={T.notifyMissing}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingAssignment(assignment);

                            const dueDateDisplay = assignment?.dueDate
                              ? apiDateTimeToDisplayDateTime(
                                  assignment.dueDate,
                                  'Asia/Ho_Chi_Minh',
                                  'HH:mm:ss dd/MM/yyyy'
                                )
                              : '';

                            setFormData({
                              title: assignment.title,
                              description: assignment.description || '',
                              dueDate: dueDateDisplay,
                              classId: assignment.classId,
                              type: assignment.type || 'essay',
                              questions: assignment.questions || [],
                              attemptsAllowed: assignment.attemptsAllowed || 1,
                              proctoringMode: normalizeAssignmentProctoringMode(
                                assignment.proctoringMode
                              ),
                            });
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-subtle hover:text-blue-600 hover:bg-blue-50 dark:bg-blue-500/10 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAssignment(assignment.id)}
                          disabled={deletingAssignmentId !== null}
                          className="p-2 text-subtle hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingAssignmentId === assignment.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-sm text-slate-600 mb-6 line-clamp-2">
                    {assignment.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 mb-6">
                    <div className="flex items-center text-xs text-muted">
                      <Calendar className="w-4 h-4 mr-1.5" />
                      {T.dueAt}
                      {formatVN(assignment.dueDate, 'dd/MM/yyyy HH:mm')}
                    </div>
                    {isStudent && (
                      <div
                        className={cn(
                          'flex items-center text-xs font-medium px-2 py-1 rounded-full',
                          submission
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
                            : isOverdue
                              ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                              : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600'
                        )}
                      >
                        {submission ? (
                          <>
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {T.submitted}
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3 mr-1" />
                            {isOverdue ? T.overdue : T.notSubmitted}
                          </>
                        )}
                      </div>
                    )}
                    {isTeacher && profile?.uid && (
                      <SubmissionCount
                        count={submissions.filter((s) => s.assignmentId === assignment.id).length}
                      />
                    )}
                  </div>

                  {isStudent && (
                    <div className="flex items-center gap-3">
                      {isBeforeAvailable ? (
                        <div className="flex-1 text-center py-2 px-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 rounded-xl text-xs font-semibold text-slate-500">
                          {language === 'vi'
                            ? `Chưa bắt đầu (Có sẵn từ ${formatVN(assignment.deliveryPolicy.availableFrom, 'dd/MM/yyyy HH:mm')})`
                            : `Not available (Available from ${formatVN(assignment.deliveryPolicy.availableFrom, 'dd/MM/yyyy HH:mm')})`}
                        </div>
                      ) : (
                        canAttempt && (
                          <button
                            onClick={() => {
                              setSelectedAssignment(assignment);
                              setSubmissionExamActive(false);
                              setIsSubmissionModalOpen(true);
                            }}
                            className="flex-1 flex items-center justify-center space-x-2 bg-blue-600 text-white py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 dark:shadow-blue-900/30"
                          >
                            <Send className="w-4 h-4" />
                            <span>
                              {attemptsMade > 0
                                ? T.reattempt
                                    .replace('{count}', (attemptsMade + 1).toString())
                                    .replace('{total}', attemptsAllowed.toString())
                                : T.doAssignment}
                            </span>
                          </button>
                        )
                      )}

                      {submission && (
                        <button
                          onClick={() => {
                            setSelectedAssignment(assignment);
                            setSelectedReviewSubmission(submission);
                            setIsReviewModalOpen(true);
                          }}
                          className={cn(
                            'flex items-center justify-center space-x-2 py-2 rounded-xl text-sm font-medium transition-all',
                            canAttempt
                              ? 'flex-1 bg-surface border border-border-default text-slate-600 hover:bg-hover'
                              : 'w-full bg-surface border border-border-default text-slate-600 hover:bg-hover'
                          )}
                        >
                          <span>{T.viewDetails}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {isStudent && attemptsMade >= attemptsAllowed && !submission?.grade && (
                    <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-100 text-amber-700 dark:text-amber-400 text-xs text-center font-medium">
                      {t.classes.permissionError} ({attemptsMade}/{attemptsAllowed}).
                    </div>
                  )}

                  {isStudent && attemptsMade > 0 && (
                    <div className="mt-4 space-y-3">
                      <p className="text-xs font-semibold text-subtle uppercase tracking-wider">
                        {T.submissionHistory
                          .replace('{count}', attemptsMade.toString())
                          .replace('{total}', attemptsAllowed.toString())}
                      </p>
                      {studentSubmissions
                        .sort(
                          (a, b) =>
                            new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
                        )
                        .map((sub, idx) => (
                          <div
                            key={sub.id}
                            className="p-3 bg-page rounded-xl border border-border-light"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold text-subtle uppercase">
                                {T.attemptPrefix} {studentSubmissions.length - idx} •{' '}
                                {formatVN(sub.submittedAt, 'dd/MM HH:mm')}
                              </span>
                              <span
                                className={cn(
                                  'text-[10px] font-bold px-2 py-0.5 rounded-full',
                                  sub.status === 'graded'
                                    ? 'bg-emerald-100 text-emerald-600'
                                    : 'bg-blue-100 text-blue-600'
                                )}
                              >
                                {sub.status === 'graded'
                                  ? `${t.pageAssignments.gradedBadge.replace('{score}', sub.grade?.toString() || '0')}`
                                  : T.submitted}
                              </span>
                            </div>
                            {assignment.type === 'quiz' ? (
                              <p className="text-xs text-slate-600">
                                {T.quizSummary.replace(
                                  '{count}',
                                  (sub.quizAnswers?.length || 0).toString()
                                )}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-600 line-clamp-1 italic">
                                "{sub.content}"
                              </p>
                            )}
                            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border-default pt-2">
                              {sub.feedback ? (
                                <div className="flex-1">
                                  <p className="text-[10px] font-bold text-emerald-600 uppercase">
                                    {T.feedbackLabel}
                                  </p>
                                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                                    {sub.feedback}
                                  </p>
                                </div>
                              ) : (
                                <div></div>
                              )}
                              <button
                                onClick={() => {
                                  setSelectedAssignment(assignment);
                                  setSelectedReviewSubmission(sub);
                                  setIsReviewModalOpen(true);
                                }}
                                className="px-3 py-1 bg-surface border border-border-default text-slate-600 text-xs font-medium rounded-lg hover:bg-hover transition-colors shrink-0"
                              >
                                {attemptsMade >= attemptsAllowed ? T.viewAnswer : T.reviewAttempt}
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {isTeacher && (
                    <SubmissionsList
                      submissions={submissions}
                      assignmentId={assignment.id}
                      assignmentType={assignment.type || 'essay'}
                      isAssessmentV2={assignment.assessment?.version === 2}
                      getStudentName={getStudentName}
                      onGrade={(sub) => {
                        setSelectedSubmission(sub);
                        setGradingData({
                          grade: sub.grade?.toString() || '',
                          feedback: sub.feedback || '',
                        });
                        setIsGradingModalOpen(true);
                      }}
                    />
                  )}
                </div>
              </motion.div>
            );
          })
        ) : (
          <div className="lg:col-span-2 flex flex-col items-center justify-center py-20 bg-surface rounded-3xl border border-dashed border-slate-300">
            <div className="w-16 h-16 bg-page rounded-2xl flex items-center justify-center text-subtle mb-4">
              {showArchived ? (
                <Archive className="w-8 h-8" />
              ) : (
                <ClipboardList className="w-8 h-8" />
              )}
            </div>
            <h3 className="text-lg font-bold text-heading">
              {showArchived ? T.emptyArchived : T.noAssignments}
            </h3>
            <p className="text-muted max-w-xs text-center mt-2">
              {showArchived
                ? T.emptyArchivedDesc
                : isTeacher
                  ? T.createFirstTeacher
                  : T.noAssignmentsStudent}
            </p>
          </div>
        )}
      </motion.div>
      <LoadMore
        hasMore={hasMoreAssignments}
        loading={false}
        onLoadMore={loadMoreAssignments}
        totalShown={assignmentsShown}
        totalAvailable={assignmentsTotal}
      />

      {/* Advanced Assessment Builder Modal */}
      <AssessmentBuilder
        isOpen={isAssessmentBuilderOpen}
        onClose={() => setIsAssessmentBuilderOpen(false)}
        classes={classes}
        isSaving={isSaving}
        onSubmit={(payload) => void handleCreateAdvancedAssignment(payload)}
      />

      {/* Create/Edit Assignment Modal */}
      <AssignmentModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingAssignment(null);
        }}
        editingAssignment={editingAssignment}
        formData={formData}
        setFormData={setFormData}
        classes={classes}
        teachers={teachers}
        onSubmit={handleCreateAssignment}
        isSaving={isSaving}
        jsonInput={jsonInput}
        setJsonInput={setJsonInput}
        onImportJson={handleImportJson}
        onAddQuestion={handleAddQuestion}
        onUpdateQuestion={handleUpdateQuestion}
        onRemoveQuestion={handleRemoveQuestion}
      />

      {/* Student Submission Modal */}
      <SubmissionModal
        isOpen={isSubmissionModalOpen}
        onClose={() => void closeSubmissionModal()}
        selectedAssignment={selectedAssignment}
        submissionExamActive={submissionExamActive}
        onStartExamSession={() => void handleStartExamSession()}
        onSubmit={handleSubmitAssignment}
        isSubmitting={isSubmitting}
        submissionData={submissionData}
        setSubmissionData={setSubmissionData}
        quizAnswers={quizAnswers}
        setQuizAnswers={setQuizAnswers}
        assessmentAnswers={assessmentAnswers}
        setAssessmentAnswers={setAssessmentAnswers}
        examMetrics={examMetrics}
        integrityOverlay={integrityOverlay}
        setIntegrityOverlay={setIntegrityOverlay}
        dictionaryOpen={dictionaryOpen}
        setDictionaryOpen={setDictionaryOpen}
        INTEGRITY_TAB_FOCUS_WARN={INTEGRITY_TAB_FOCUS_WARN}
        INTEGRITY_TAB_FOCUS_AUTO_SUBMIT={INTEGRITY_TAB_FOCUS_AUTO_SUBMIT}
        INTEGRITY_FULLSCREEN_AUTO_SUBMIT={INTEGRITY_FULLSCREEN_AUTO_SUBMIT}
        proctoringMode={selectedProctoringMode}
        attemptDraftStatus={attemptAutosave.status}
        attemptDraftRestored={attemptAutosave.restoredDraft}
        onClearAttemptDraft={() => {
          void attemptAutosave.clearDraft();
          setSubmissionData({ content: '' });
          setQuizAnswers([]);
          setAssessmentAnswers([]);
        }}
      />

      {/* Teacher Grading Modal */}
      <GradingModal
        isOpen={isGradingModalOpen}
        onClose={() => setIsGradingModalOpen(false)}
        selectedSubmission={selectedSubmission}
        assignments={assignments}
        students={students}
        gradingData={gradingData}
        setGradingData={setGradingData}
        onSubmit={handleGradeSubmission}
        isGrading={isGrading}
        INTEGRITY_TAB_FOCUS_AUTO_SUBMIT={INTEGRITY_TAB_FOCUS_AUTO_SUBMIT}
        INTEGRITY_FULLSCREEN_AUTO_SUBMIT={INTEGRITY_FULLSCREEN_AUTO_SUBMIT}
      />

      {/* Student Review Modal */}
      {selectedAssignment && (
        <StudentSubmissionReviewModal
          isOpen={isReviewModalOpen}
          onClose={() => {
            setIsReviewModalOpen(false);
            setSelectedReviewSubmission(null);
            setSelectedAssignment(null);
          }}
          assignment={selectedAssignment}
          submission={selectedReviewSubmission}
          showCorrectAnswers={canStudentReviewAssignmentResults({
            deliveryPolicy: selectedAssignment.deliveryPolicy,
            dueDate: selectedAssignment.dueDate,
            submissionCount:
              submissions.filter(
                (s) =>
                  s.assignmentId === selectedAssignment.id && s.studentId === profile?.studentId
              )?.length || 0,
            attemptsAllowed: selectedAssignment.attemptsAllowed || 1,
          })}
        />
      )}

      {/* Notify Missing Assignment Modal */}
      <NotifyMissingAssignmentModal
        assignment={notifyMissingAssignment}
        onClose={() => setNotifyMissingAssignment(null)}
        students={students}
        submissions={submissions}
        sendingNotificationId={sendingNotificationId}
        onSendNotification={handleSendNotification}
      />

      {/* Assignment Operations Panel */}
      {operationsAssignmentId && (
        <AssignmentOperationsPanel
          assignmentId={operationsAssignmentId}
          onClose={() => setOperationsAssignmentId(null)}
        />
      )}
    </div>
  );
}
