import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  Filter,
  GraduationCap,
  Info,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MessageCircle,
  PackageOpen,
  RefreshCw,
  Search,
  Send,
  Users,
  Wallet,
  ChevronDown,
  Zap,
  Bell,
} from 'lucide-react';
import type { Class, CourseFeeLedger, Evaluation, Student } from '../../types';
import {
  sendZaloEvaluationNotification,
  sendZaloRankNotification,
  sendZaloTuitionNoticeNotification,
} from '../../lib/zalo/zaloService';
import { createZaloBulkNotificationJob } from '../../hooks/useZaloNotifications';
import { cn } from '../../lib/core/utils';
import {
  isCurrentAcademicStudent,
  isOfficeAcademicClassVisible,
  isRequiredAcademicEvaluationStudent,
  normalizeAcademicEnrollmentStatus,
  selectFinalEvaluation,
} from '../../../shared/academic';
import { isRankedEvaluation, normalizeEvaluationRank } from '../../../shared/evaluationRank';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { CourseClosingExemptionModal } from '../../components/office/CourseClosingExemptionModal';
import {
  dateOnlyTimestamp,
  formatDateOnlyDisplay,
  toVietnamDateOnly,
} from '../../lib/office/dateOnly';
import { officeAcademicQueryOptions } from '../../lib/office/officeAcademicQueries';

type AcademicClass = Partial<Class> & { id: string; name: string };
type AcademicStudent = Partial<Student> & { id: string; name: string; classId: string };
type AcademicEvaluation = Partial<Evaluation> & {
  id: string;
  studentId: string;
  classId: string;
  positivePoints?: string[] | string;
};
type AcademicLedger = Partial<CourseFeeLedger> & {
  id: string;
  studentId?: string;
  classId?: string;
};

type AcademicTeacher = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
};

type AcademicSummary = {
  classId: string;
  eligibleStudentCount: number;
  finalEvaluationCount: number;
  isEvaluationComplete: boolean;
  evaluationSentCount: number;
  tuitionNoticeSentCount: number;
  missingEvaluationStudentIds: string[];
  failedNotificationCount: number;
  evaluationSentStudentIds?: string[];
  rankSentStudentIds?: string[];
  tuitionNoticeSentStudentIds?: string[];
  // Canonical server snapshot. It is the only authorization signal for sending;
  // `isEvaluationComplete` remains for legacy display only.
  courseClosing: CourseClosingSnapshot;
};

export type AcademicPayload = {
  classes: AcademicClass[];
  students: AcademicStudent[];
  evaluations: AcademicEvaluation[];
  ledgers: AcademicLedger[];
  summaries: Record<string, AcademicSummary>;
  teachers?: AcademicTeacher[];
};

type BatchMode = 'evaluation' | 'rank' | 'tuition' | 'both';
type BatchStatus = 'sent' | 'skipped' | 'failed' | '-';

type BatchResult = {
  studentId: string;
  studentName: string;
  evaluation: BatchStatus;
  rank: BatchStatus;
  tuition: BatchStatus;
  error?: string;
};

type SentSets = {
  evaluation: Set<string>;
  rank: Set<string>;
  tuition: Set<string>;
};

type LocalSentByClass = Record<string, { evaluation: string[]; rank: string[]; tuition: string[] }>;

type StudentActionState = {
  finalEvaluation: AcademicEvaluation | null;
  rank: ReturnType<typeof rankFromEvaluation>;
  onLeaveMissingEvaluation: boolean;
  evaluationSent: boolean;
  rankSent: boolean;
  tuitionSent: boolean;
  rankRequired: boolean;
  exemptionReason?: string;
  completed: boolean;
  evaluationActionDisabled: boolean;
  tuitionActionDisabled: boolean;
  bothActionDisabled: boolean;
  rankActionDisabled: boolean;
  evaluationActionTitle?: string;
  tuitionActionTitle?: string;
  rankActionTitle?: string;
};

type RankNotificationResult = {
  status: BatchStatus;
  sent: boolean;
  error?: string;
};

type BulkNotificationItem = {
  studentId: string;
  ledgerId?: string;
};

type BulkNotificationResult = {
  studentId: string;
  success: boolean;
  messageId?: string;
  error?: string;
  alreadySent?: boolean;
};

const currencyFormatter = new Intl.NumberFormat('vi-VN');
const classActionKey = (mode: BatchMode) => `${mode}:class`;
const studentActionKey = (mode: BatchMode, studentId: string) => `${mode}:student:${studentId}`;
const ON_LEAVE_MISSING_EVALUATION_REASON = 'Học sinh tạm nghỉ và giáo viên chưa nhập nhận xét.';
const COURSE_CLOSING_BLOCKED_REASON = 'Giáo viên phụ trách chưa xác nhận chốt khóa cho lớp này.';

const COURSE_CLOSING_BLOCKER_MESSAGES: Record<CourseClosingSnapshot['status'], string> = {
  no_required_students: 'Lớp không có học viên bắt buộc để chốt khóa.',
  missing_evaluations: 'Giáo viên chưa nhập đủ nhận xét cuối khóa cho lớp này.',
  ready_for_approval: 'Giáo viên phụ trách chưa xác nhận cho Office gửi.',
  stale: 'Xác nhận chốt khóa đã mất hiệu lực. Cần giáo viên xác nhận lại.',
  approved: '',
  sending: '',
  completed: '',
};

function courseClosingBlockerMessage(snapshot: CourseClosingSnapshot): string {
  return COURSE_CLOSING_BLOCKER_MESSAGES[snapshot.status] || COURSE_CLOSING_BLOCKED_REASON;
}

function textFromValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join('; ');
  return String(value || '').trim();
}

function scoreFromEvaluation(evaluation: AcademicEvaluation): string {
  const score = evaluation.finalScore ?? evaluation.totalScore ?? '';
  return String(score);
}

function rankFromEvaluation(evaluation: AcademicEvaluation | null) {
  return normalizeEvaluationRank(evaluation?.rank);
}

function isOnLeaveWithoutFinalEvaluation(
  student: AcademicStudent,
  finalEvaluation: AcademicEvaluation | null
): boolean {
  return (
    normalizeAcademicEnrollmentStatus(student.enrollmentStatus) === 'on_leave' && !finalEvaluation
  );
}

function findLedgerForStudent(
  ledgers: AcademicLedger[],
  studentId: string,
  classData: AcademicClass
) {
  const studentLedgers = ledgers.filter(
    (ledger) => ledger.studentId === studentId && ledger.classId === classData.id
  );
  return (
    studentLedgers.find(
      (ledger) =>
        String(ledger.termStart || '') === String(classData.startDate || '') &&
        String(ledger.termEnd || '') === String(classData.endDate || '')
    ) || studentLedgers[0]
  );
}

function formatPercent(count?: number, total?: number): string {
  const safeCount = Number(count || 0);
  const safeTotal = Number(total || 0);
  if (safeTotal <= 0) return safeCount > 0 ? '100%' : '0%';
  return `${Math.min(100, Math.round((safeCount / safeTotal) * 100))}%`;
}

function formatCourseDate(dateStr?: string): string {
  return formatDateOnlyDisplay(dateStr);
}

type PriorityTier = 1 | 2 | 3 | 4;

function getClassPriorityTier(
  summary: AcademicSummary | undefined,
  endDate: string | undefined
): PriorityTier {
  const complete = Boolean(summary?.isEvaluationComplete);
  const allSent =
    complete && (summary?.evaluationSentCount ?? 0) >= (summary?.eligibleStudentCount ?? 0);

  if (allSent) return 4; // Hoàn tất -> bottom
  if (complete) return 1; // Đủ nhận xét nhưng chưa gửi xong -> top (Cần gửi)

  // Chưa đủ nhận xét -> check đã kết khóa chưa
  const todayValue = dateOnlyTimestamp(toVietnamDateOnly(Date.now()));
  const endValue = dateOnlyTimestamp(endDate);
  const courseEnded = endValue !== null && todayValue !== null && endValue <= todayValue;

  return courseEnded ? 2 : 3; // 2: Cần nhận xét, 3: Chưa đủ
}

function pruneConfirmedLocalSent(
  current: LocalSentByClass,
  summaries: Record<string, AcademicSummary>
): LocalSentByClass {
  const next: LocalSentByClass = {};

  for (const [classId, sent] of Object.entries(current)) {
    const summary = summaries[classId];
    if (!summary) {
      next[classId] = sent;
      continue;
    }

    const confirmedEvaluation = new Set(summary.evaluationSentStudentIds || []);
    const confirmedRank = new Set(summary.rankSentStudentIds || []);
    const confirmedTuition = new Set(summary.tuitionNoticeSentStudentIds || []);
    const pruned = {
      evaluation: sent.evaluation.filter((studentId) => !confirmedEvaluation.has(studentId)),
      rank: sent.rank.filter((studentId) => !confirmedRank.has(studentId)),
      tuition: sent.tuition.filter((studentId) => !confirmedTuition.has(studentId)),
    };

    if (pruned.evaluation.length || pruned.rank.length || pruned.tuition.length) {
      next[classId] = pruned;
    }
  }

  return next;
}

function appendBatchError(
  current: string | undefined,
  next: string | undefined
): string | undefined {
  return [current, next].filter(Boolean).join(' | ') || undefined;
}

function getStudentActionState({
  student,
  finalEvaluation,
  sentSets,
  selectedSummary,
  actionLoading,
}: {
  student: AcademicStudent;
  finalEvaluation: AcademicEvaluation | null;
  sentSets: SentSets;
  selectedSummary: AcademicSummary;
  actionLoading: string | null;
}): StudentActionState {
  const snapshot = selectedSummary.courseClosing;
  const rank = rankFromEvaluation(finalEvaluation);
  const rankRequired = isRankedEvaluation(rank);
  const onLeaveMissingEvaluation = isOnLeaveWithoutFinalEvaluation(student, finalEvaluation);
  const evaluationSent = sentSets.evaluation.has(student.id);
  const rankSent = sentSets.rank.has(student.id);
  const tuitionSent = sentSets.tuition.has(student.id);

  const exemption = snapshot.exemptions.find((entry) => entry.studentId === student.id);
  const approvalBlocked = !snapshot.approvalValid;
  const busy = Boolean(actionLoading);

  // The server snapshot is authoritative: a channel is sendable only while it is
  // still listed as pending for this student under a valid approval.
  const evaluationPending = snapshot.pendingEvaluationStudentIds.includes(student.id);
  const rankPending = snapshot.pendingRankStudentIds.includes(student.id);
  const tuitionPending = snapshot.pendingTuitionStudentIds.includes(student.id);

  const blockedReason = approvalBlocked
    ? COURSE_CLOSING_BLOCKED_REASON
    : exemption
      ? `Đã miễn gửi: ${exemption.reason}`
      : undefined;

  const evaluationActionDisabled =
    busy || approvalBlocked || Boolean(exemption) || !evaluationPending || !finalEvaluation;
  // Tuition additionally depends on evaluation evidence already existing.
  const tuitionActionDisabled =
    busy ||
    approvalBlocked ||
    Boolean(exemption) ||
    !tuitionPending ||
    onLeaveMissingEvaluation ||
    evaluationPending;
  const rankActionDisabled =
    busy || approvalBlocked || Boolean(exemption) || !rankRequired || !rankPending;

  return {
    finalEvaluation,
    rank,
    onLeaveMissingEvaluation,
    evaluationSent,
    rankSent,
    tuitionSent,
    rankRequired,
    exemptionReason: exemption?.reason,
    completed: evaluationSent && tuitionSent && (!rankRequired || rankSent),
    evaluationActionDisabled,
    tuitionActionDisabled,
    bothActionDisabled: evaluationActionDisabled,
    rankActionDisabled,
    evaluationActionTitle:
      blockedReason || (onLeaveMissingEvaluation ? ON_LEAVE_MISSING_EVALUATION_REASON : undefined),
    tuitionActionTitle:
      blockedReason ||
      (onLeaveMissingEvaluation
        ? ON_LEAVE_MISSING_EVALUATION_REASON
        : evaluationPending
          ? 'Cần gửi nhận xét Zalo thành công trước khi gửi học phí'
          : undefined),
    rankActionTitle:
      blockedReason || (rankRequired ? undefined : 'Chỉ gửi được khi học viên có hạng'),
  };
}

async function sendRankNotificationForStudent({
  student,
  selectedClass,
  finalEvaluation,
  rankAlreadySent,
}: {
  student: AcademicStudent;
  selectedClass: AcademicClass;
  finalEvaluation: AcademicEvaluation | null;
  rankAlreadySent: boolean;
}): Promise<RankNotificationResult> {
  const rank = rankFromEvaluation(finalEvaluation);
  if (!finalEvaluation || !isRankedEvaluation(rank)) {
    return { status: 'skipped', sent: false };
  }
  if (rankAlreadySent) {
    return { status: 'skipped', sent: false };
  }

  const result = await sendZaloRankNotification({
    studentId: student.id,
    classId: selectedClass.id,
  });

  return {
    status: result.success ? 'sent' : 'failed',
    sent: result.success,
    error: result.success ? undefined : result.error || 'Không gửi được thông báo hạng',
  };
}

function EmptyStudentsState() {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-10 text-center">
      <div
        aria-hidden="true"
        className="relative mb-5 flex h-28 w-40 items-center justify-center text-blue-500"
      >
        <div className="absolute bottom-4 h-16 w-20 rounded-lg bg-blue-100 shadow-inner" />
        <div className="absolute bottom-10 left-9 h-8 w-8 rotate-[-18deg] rounded-lg border border-blue-200 bg-white" />
        <PackageOpen className="relative z-10 h-16 w-16 text-blue-400" strokeWidth={1.7} />
        <Send className="absolute right-8 top-3 h-9 w-9 rotate-12 fill-blue-300 text-blue-400" />
        <div className="absolute left-6 top-8 h-10 w-4 rounded-full bg-blue-100" />
        <div className="absolute right-4 bottom-8 h-12 w-4 rounded-full bg-blue-100" />
      </div>
      <h3 className="text-lg font-extrabold text-slate-700">Chưa có dữ liệu học sinh</h3>
      <p className="mt-2 max-w-md text-sm font-medium text-slate-400">
        Danh sách học sinh sẽ hiển thị tại đây khi có dữ liệu.
      </p>
    </div>
  );
}

export default function Academic() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const isAdmin = profile?.role === 'admin';
  const [exemptionTarget, setExemptionTarget] = useState<{
    studentId: string;
    studentName: string;
  } | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [localSent, setLocalSent] = useState<LocalSentByClass>({});

  // Redesign state variables
  const [activeTab, setActiveTab] = useState<'overview' | 'students'>('overview');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [classSearchQuery, setClassSearchQuery] = useState('');
  const [studentFilter, setStudentFilter] = useState<
    'all' | 'no_eval' | 'unsent_eval' | 'unsent_tuition' | 'failed'
  >('all');
  const [selectedClassDropdownOpen, setSelectedClassDropdownOpen] = useState(false);
  const [activeDirectoryTab, setActiveDirectoryTab] = useState<'pending' | 'completed'>('pending');
  const [notificationsDropdownOpen, setNotificationsDropdownOpen] = useState(false);

  const academicQuery = useQuery(
    officeAcademicQueryOptions(
      { uid: profile?.uid || '', role: profile?.role || '' },
      Boolean(profile?.uid)
    )
  );

  const payload = useMemo(() => {
    const data = academicQuery.data;
    if (!data) return null;
    const visibleClasses = (data.classes || []).filter(isOfficeAcademicClassVisible);
    const visibleClassIds = new Set(visibleClasses.map((classItem) => classItem.id));
    return {
      ...data,
      classes: visibleClasses,
      students: (data.students || []).filter((student) => visibleClassIds.has(student.classId)),
      evaluations: (data.evaluations || []).filter((evaluation) =>
        visibleClassIds.has(evaluation.classId)
      ),
      ledgers: (data.ledgers || []).filter((ledger) =>
        visibleClassIds.has(String(ledger.classId || ''))
      ),
      summaries: Object.fromEntries(
        Object.entries(data.summaries || {}).filter(([classId]) => visibleClassIds.has(classId))
      ),
    };
  }, [academicQuery.data]);

  const loading = academicQuery.isPending;
  const cachedRefreshError = academicQuery.isError && Boolean(academicQuery.data);

  useEffect(() => {
    if (!payload) return;
    setLocalSent((current) => pruneConfirmedLocalSent(current, payload.summaries || {}));
    setSelectedClassId((current) => {
      const visibleClassIds = new Set(payload.classes.map((classItem) => classItem.id));
      return current && visibleClassIds.has(current) ? current : payload.classes[0]?.id || '';
    });
  }, [payload]);

  useEffect(() => {
    if (!academicQuery.isError) return;
    toast.error(
      academicQuery.error instanceof Error
        ? academicQuery.error.message
        : 'Không tải được dữ liệu học vụ'
    );
  }, [academicQuery.error, academicQuery.isError]);

  const loadAcademic = useCallback(
    async (isRefresh = false) => {
      const result = await academicQuery.refetch({ cancelRefetch: false });
      if (isRefresh && result.isSuccess) {
        toast.success('Làm mới dữ liệu thành công');
      }
    },
    [academicQuery.refetch]
  );

  const selectedClass = useMemo(
    () => payload?.classes.find((item) => item.id === selectedClassId) || null,
    [payload, selectedClassId]
  );
  const selectedSummary = selectedClass ? payload?.summaries[selectedClass.id] : null;
  const selectedStudents = useMemo(() => {
    if (!payload || !selectedClass) return [];
    return payload.students
      .filter(
        (student) => student.classId === selectedClass.id && isCurrentAcademicStudent(student)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [payload, selectedClass]);
  const teachersById = useMemo(
    () => new Map((payload?.teachers || []).map((teacher) => [teacher.uid, teacher.displayName])),
    [payload?.teachers]
  );

  const evaluationsByStudent = useMemo(() => {
    const map = new Map<string, AcademicEvaluation[]>();
    if (!payload || !selectedClass) return map;
    for (const evaluation of payload.evaluations) {
      if (evaluation.classId !== selectedClass.id) continue;
      const list = map.get(evaluation.studentId) || [];
      list.push(evaluation);
      map.set(evaluation.studentId, list);
    }
    return map;
  }, [payload, selectedClass]);

  const sentSets = useMemo(() => {
    const local = selectedClassId ? localSent[selectedClassId] : undefined;
    return {
      evaluation: new Set([
        ...(selectedSummary?.evaluationSentStudentIds || []),
        ...(local?.evaluation || []),
      ]),
      rank: new Set([...(selectedSummary?.rankSentStudentIds || []), ...(local?.rank || [])]),
      tuition: new Set([
        ...(selectedSummary?.tuitionNoticeSentStudentIds || []),
        ...(local?.tuition || []),
      ]),
    };
  }, [localSent, selectedClassId, selectedSummary]);
  const classEvaluationLoading = actionLoading === classActionKey('evaluation');
  const classTuitionLoading = actionLoading === classActionKey('tuition');
  const classBothLoading = actionLoading === classActionKey('both');
  const classes = payload?.classes || [];
  const sortedClasses = useMemo(() => {
    return [...classes].sort((a, b) => {
      const tierA = getClassPriorityTier(payload?.summaries[a.id], a.endDate);
      const tierB = getClassPriorityTier(payload?.summaries[b.id], b.endDate);
      if (tierA !== tierB) return tierA - tierB;

      // Trong cùng tier → gần kết khóa hơn lên trên (endDate ascending)
      const endA = dateOnlyTimestamp(a.endDate) ?? Infinity;
      const endB = dateOnlyTimestamp(b.endDate) ?? Infinity;
      return endA - endB;
    });
  }, [classes, payload?.summaries]);

  const completedClassCount = sortedClasses.filter(
    (classItem) => getClassPriorityTier(payload?.summaries[classItem.id], classItem.endDate) === 4
  ).length;

  const studentNamesMap = useMemo(() => {
    if (!payload) return new Map<string, string>();
    return new Map(payload.students.map((s) => [s.id, s.name]));
  }, [payload]);

  const dynamicNotifications = useMemo(() => {
    if (!payload) return [];
    const list: {
      id: string;
      type: 'success' | 'warning' | 'info';
      title: string;
      description: string;
      time: string;
    }[] = [];

    // Loop through all classes and their summaries to generate dynamic alerts
    for (const classItem of payload.classes) {
      const summary = payload.summaries[classItem.id];
      if (!summary) continue;

      const teacherName = teachersById.get(String(classItem.teacherId || '')) || 'Giáo viên';

      // 1. Check if class has completed evaluations
      if (summary.isEvaluationComplete) {
        list.push({
          id: `eval-complete-${classItem.id}`,
          type: 'success',
          title: 'Nhận xét lớp hoàn tất',
          description: `Giáo viên ${teacherName} đã hoàn thành đầy đủ nhận xét cuối khóa cho lớp ${classItem.name}.`,
          time: 'Gần đây',
        });

        // 2. Check if evaluations are complete but Zalo messages are not fully sent
        if (summary.evaluationSentCount < summary.eligibleStudentCount) {
          list.push({
            id: `eval-ready-send-${classItem.id}`,
            type: 'info',
            title: 'Cần gửi nhận xét học tập',
            description: `Lớp ${classItem.name} đã đủ nhận xét cuối khóa, sẵn sàng để gửi Zalo hàng loạt.`,
            time: 'Hôm nay',
          });
        }
      }

      // 3. Check if there are failed notifications
      if (summary.failedNotificationCount > 0) {
        list.push({
          id: `zalo-failed-${classItem.id}`,
          type: 'warning',
          title: 'Lỗi gửi Zalo',
          description: `Lớp ${classItem.name} phát hiện ${summary.failedNotificationCount} lỗi gửi thông báo Zalo cần kiểm tra.`,
          time: 'Khẩn cấp',
        });
      }
    }

    return list.slice(0, 5);
  }, [payload, teachersById]);

  const filteredClasses = useMemo(() => {
    return sortedClasses.filter((classItem) =>
      classItem.name.toLowerCase().includes(classSearchQuery.toLowerCase())
    );
  }, [sortedClasses, classSearchQuery]);

  const filteredStudents = useMemo(() => {
    return selectedStudents.filter((student) => {
      // Search filter
      const matchesSearch =
        student.name.toLowerCase().includes(studentSearchQuery.toLowerCase()) ||
        student.studentId?.toLowerCase().includes(studentSearchQuery.toLowerCase());
      if (!matchesSearch) return false;

      // Status filter
      const finalEvaluation = selectFinalEvaluation(evaluationsByStudent.get(student.id) || []);
      const evaluationSent = sentSets.evaluation.has(student.id);
      const tuitionSent = sentSets.tuition.has(student.id);

      switch (studentFilter) {
        case 'no_eval':
          return !finalEvaluation;
        case 'unsent_eval':
          return Boolean(finalEvaluation) && !evaluationSent;
        case 'unsent_tuition':
          return !isOnLeaveWithoutFinalEvaluation(student, finalEvaluation) && !tuitionSent;
        case 'failed': {
          const res = results.find((r) => r.studentId === student.id);
          return res?.evaluation === 'failed' || res?.tuition === 'failed';
        }
        default:
          return true;
      }
    });
  }, [
    selectedStudents,
    studentSearchQuery,
    studentFilter,
    evaluationsByStudent,
    sentSets,
    results,
  ]);

  const displayStudents = useMemo(() => {
    let list = filteredStudents;
    if (activeDirectoryTab === 'completed' && selectedSummary) {
      list = list.filter((student) => {
        const finalEvaluation = selectFinalEvaluation(evaluationsByStudent.get(student.id) || []);
        return getStudentActionState({
          student,
          finalEvaluation,
          sentSets,
          selectedSummary,
          actionLoading,
        }).completed;
      });
    }
    return list;
  }, [
    filteredStudents,
    activeDirectoryTab,
    sentSets,
    selectedSummary,
    evaluationsByStudent,
    actionLoading,
  ]);

  const addLocalSent = (
    classId: string,
    type: 'evaluation' | 'rank' | 'tuition',
    studentId: string
  ) => {
    setLocalSent((current) => {
      const existing = current[classId] || { evaluation: [], rank: [], tuition: [] };
      return {
        ...current,
        [classId]: {
          ...existing,
          [type]: [...new Set([...existing[type], studentId])],
        },
      };
    });
  };

  const runBatch = async (mode: BatchMode, targetStudents?: AcademicStudent[]) => {
    if (!payload || !selectedClass || !selectedSummary) return;
    // Canonical approval gate. It runs before any mode-specific logic so that no
    // mode — including `rank` and `both` — can become a bypass.
    if (!selectedSummary.courseClosing.approvalValid) {
      toast.error(courseClosingBlockerMessage(selectedSummary.courseClosing));
      return;
    }

    const studentsToProcess = targetStudents || selectedStudents;
    setActionLoading(
      targetStudents?.length === 1
        ? studentActionKey(mode, targetStudents[0].id)
        : classActionKey(mode)
    );
    const nextResults: BatchResult[] = [];

    if (!targetStudents || targetStudents.length > 1) {
      const rowsByStudentId = new Map<string, BatchResult>();
      const finalEvaluationByStudentId = new Map<string, AcademicEvaluation | null>();
      const rankItems: BulkNotificationItem[] = [];

      const sendBulk = async (
        type: 'evaluation' | 'rank_achievement' | 'tuition_notice',
        items: BulkNotificationItem[]
      ) => {
        if (items.length === 0) return new Map<string, BulkNotificationResult>();
        const response = await createZaloBulkNotificationJob({
          classId: selectedClass.id,
          type,
          items,
        });
        return new Map(
          (response.results || []).map((result) => [result.studentId, result] as const)
        );
      };

      const queueRankItem = (
        student: AcademicStudent,
        finalEvaluation: AcademicEvaluation | null,
        row: BatchResult
      ) => {
        const rank = rankFromEvaluation(finalEvaluation);
        if (!finalEvaluation || !isRankedEvaluation(rank)) {
          row.rank = row.rank === '-' ? 'skipped' : row.rank;
          return;
        }
        if (sentSets.rank.has(student.id)) {
          row.rank = 'skipped';
          return;
        }
        rankItems.push({ studentId: student.id });
      };

      const evaluationItems: BulkNotificationItem[] = [];
      for (const student of studentsToProcess) {
        const finalEvaluation = selectFinalEvaluation(evaluationsByStudent.get(student.id) || []);
        const evaluationAlreadySent = sentSets.evaluation.has(student.id);
        const row: BatchResult = {
          studentId: student.id,
          studentName: student.name,
          evaluation: '-',
          rank: '-',
          tuition: '-',
        };
        rowsByStudentId.set(student.id, row);
        finalEvaluationByStudentId.set(student.id, finalEvaluation);
        nextResults.push(row);

        if (mode === 'evaluation' || mode === 'both') {
          if (evaluationAlreadySent) {
            row.evaluation = 'skipped';
            if (mode === 'both') queueRankItem(student, finalEvaluation, row);
          } else if (!finalEvaluation) {
            if (isRequiredAcademicEvaluationStudent(student)) {
              row.evaluation = 'failed';
              row.error = 'Thiếu nhận xét cuối khóa';
            } else {
              row.evaluation = 'skipped';
              row.error = ON_LEAVE_MISSING_EVALUATION_REASON;
            }
          } else {
            evaluationItems.push({ studentId: student.id });
          }
        }

        if (mode === 'rank') {
          queueRankItem(student, finalEvaluation, row);
        }
      }

      try {
        const evaluationResults = await sendBulk('evaluation', evaluationItems);
        for (const item of evaluationItems) {
          const row = rowsByStudentId.get(item.studentId);
          const student = studentsToProcess.find((entry) => entry.id === item.studentId);
          if (!row || !student) continue;
          const result = evaluationResults.get(item.studentId);
          if (result?.success || result?.alreadySent) {
            row.evaluation = result.alreadySent ? 'skipped' : 'sent';
            addLocalSent(selectedClass.id, 'evaluation', item.studentId);
            queueRankItem(student, finalEvaluationByStudentId.get(item.studentId) || null, row);
          } else {
            row.evaluation = 'failed';
            row.error = appendBatchError(row.error, result?.error || 'Không gửi được nhận xét');
          }
        }

        const rankResults = await sendBulk('rank_achievement', rankItems);
        for (const item of rankItems) {
          const row = rowsByStudentId.get(item.studentId);
          if (!row) continue;
          const result = rankResults.get(item.studentId);
          if (result?.success || result?.alreadySent) {
            row.rank = result.alreadySent ? 'skipped' : 'sent';
            addLocalSent(selectedClass.id, 'rank', item.studentId);
          } else {
            row.rank = 'failed';
            row.error = appendBatchError(
              row.error,
              result?.error || 'Không gửi được thông báo hạng'
            );
          }
        }

        if (mode === 'tuition' || mode === 'both') {
          const tuitionItems: BulkNotificationItem[] = [];
          for (const student of studentsToProcess) {
            const row = rowsByStudentId.get(student.id);
            if (!row) continue;
            const finalEvaluation = finalEvaluationByStudentId.get(student.id) || null;
            const evaluationAlreadySent = sentSets.evaluation.has(student.id);
            const canSendTuitionAfterEvaluation =
              evaluationAlreadySent || row.evaluation === 'sent';
            if (!canSendTuitionAfterEvaluation) {
              row.tuition = 'skipped';
              row.error = appendBatchError(
                row.error,
                'Không gửi học phí vì nhận xét chưa gửi thành công'
              );
              continue;
            }
            if (isOnLeaveWithoutFinalEvaluation(student, finalEvaluation)) {
              row.tuition = 'skipped';
              row.error = row.error || ON_LEAVE_MISSING_EVALUATION_REASON;
              continue;
            }
            if (sentSets.tuition.has(student.id)) {
              row.tuition = 'skipped';
              continue;
            }

            const ledger = findLedgerForStudent(payload.ledgers, student.id, selectedClass);
            tuitionItems.push({
              studentId: student.id,
              ...(ledger ? { ledgerId: ledger.id } : {}),
            });
          }

          const tuitionResults = await sendBulk('tuition_notice', tuitionItems);
          for (const item of tuitionItems) {
            const row = rowsByStudentId.get(item.studentId);
            if (!row) continue;
            const result = tuitionResults.get(item.studentId);
            if (result?.success || result?.alreadySent) {
              row.tuition = result.alreadySent ? 'skipped' : 'sent';
              addLocalSent(selectedClass.id, 'tuition', item.studentId);
            } else {
              row.tuition = 'failed';
              row.error = appendBatchError(
                row.error,
                result?.error || 'Không gửi được thông báo học phí'
              );
            }
          }
        }

        setResults(nextResults);
        void loadAcademic();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không gửi được thông báo hàng loạt');
        setResults(nextResults);
      } finally {
        setActionLoading(null);
      }
      return;
    }

    for (const student of studentsToProcess) {
      const finalEvaluation = selectFinalEvaluation(evaluationsByStudent.get(student.id) || []);
      const onLeaveMissingEvaluation = isOnLeaveWithoutFinalEvaluation(student, finalEvaluation);
      const evaluationAlreadySent = sentSets.evaluation.has(student.id);
      const row: BatchResult = {
        studentId: student.id,
        studentName: student.name,
        evaluation: '-',
        rank: '-',
        tuition: '-',
      };

      const recordRankResult = async () => {
        const rankResult = await sendRankNotificationForStudent({
          student,
          selectedClass,
          finalEvaluation,
          rankAlreadySent: sentSets.rank.has(student.id),
        });
        row.rank = rankResult.status;
        if (rankResult.sent) {
          addLocalSent(selectedClass.id, 'rank', student.id);
        }
        row.error = appendBatchError(row.error, rankResult.error);
      };

      if (mode === 'evaluation' || mode === 'both') {
        if (evaluationAlreadySent) {
          row.evaluation = 'skipped';
          if (mode === 'both') {
            await recordRankResult();
          }
        } else if (!finalEvaluation) {
          if (isRequiredAcademicEvaluationStudent(student)) {
            row.evaluation = 'failed';
            row.error = 'Thiếu nhận xét cuối khóa';
          } else {
            row.evaluation = 'skipped';
            row.error = ON_LEAVE_MISSING_EVALUATION_REASON;
          }
        } else {
          const result = await sendZaloEvaluationNotification({
            studentId: student.id,
            classId: selectedClass.id,
          });
          row.evaluation = result.success ? 'sent' : 'failed';
          if (result.success) {
            addLocalSent(selectedClass.id, 'evaluation', student.id);
            await recordRankResult();
          } else {
            row.error = result.error || 'Không gửi được nhận xét';
          }
        }
      }

      if (mode === 'rank') {
        await recordRankResult();
      }

      if (mode === 'tuition' || mode === 'both') {
        const canSendTuitionAfterEvaluation = evaluationAlreadySent || row.evaluation === 'sent';
        if (!canSendTuitionAfterEvaluation) {
          row.tuition = 'skipped';
          row.error = appendBatchError(
            row.error,
            'Không gửi học phí vì nhận xét chưa gửi thành công'
          );
        } else if (onLeaveMissingEvaluation) {
          row.tuition = 'skipped';
          row.error = row.error || ON_LEAVE_MISSING_EVALUATION_REASON;
        } else if (sentSets.tuition.has(student.id)) {
          row.tuition = 'skipped';
        } else {
          const ledger = findLedgerForStudent(payload.ledgers, student.id, selectedClass);
          const result = await sendZaloTuitionNoticeNotification({
            ...(ledger
              ? { ledgerId: ledger.id }
              : { studentId: student.id, classId: selectedClass.id }),
          });
          row.tuition = result.success ? 'sent' : result.alreadySent ? 'skipped' : 'failed';
          if (result.success || result.alreadySent)
            addLocalSent(selectedClass.id, 'tuition', student.id);
          if (!result.success && !result.alreadySent) {
            row.error = appendBatchError(
              row.error,
              result.error || 'Không gửi được thông báo học phí'
            );
          }
        }
      }

      nextResults.push(row);
    }

    setResults(nextResults);
    setActionLoading(null);
    void loadAcademic();
  };

  if (loading && !payload) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="academic-dashboard w-full max-w-none space-y-5 text-slate-900">
      {/* Page Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-white text-blue-600 shadow-[0_14px_32px_rgba(37,99,235,0.12)]">
            <GraduationCap className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold leading-tight text-heading">Học vụ</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Theo dõi, quản lý và gửi thông báo cho phụ huynh một cách dễ dàng
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadAcademic(true)}
          disabled={Boolean(actionLoading) || academicQuery.isFetching}
          className={cn(
            'inline-flex h-11 items-center justify-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-[0_10px_26px_rgba(15,23,42,0.08)] transition',
            actionLoading || academicQuery.isFetching
              ? 'cursor-not-allowed opacity-60'
              : 'hover:bg-slate-50'
          )}
        >
          <RefreshCw className={cn('h-4 w-4', academicQuery.isFetching && 'animate-spin')} />
          Làm mới
        </button>
      </div>

      {cachedRefreshError ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>Không thể cập nhật dữ liệu mới. Đang hiển thị bản đã lưu.</span>
          <button
            type="button"
            disabled={academicQuery.isFetching}
            onClick={() => void loadAcademic(false)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', academicQuery.isFetching && 'animate-spin')} />
            Thử lại
          </button>
        </div>
      ) : null}

      <div className="grid w-full min-w-0 items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-stretch">
        {/* Left sidebar - Class List Selector */}
        <aside
          role="navigation"
          aria-label="Chọn khóa học"
          className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white/95 shadow-[0_18px_54px_rgba(37,99,235,0.09)] lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]"
        >
          <div className="border-b border-slate-100 bg-gradient-to-br from-white via-white to-blue-50/60 px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-[0_12px_26px_rgba(37,99,235,0.22)]">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-extrabold leading-tight text-slate-900">Khóa học</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {classes.length} khóa lớp · {completedClassCount} xong
                </p>
              </div>
            </div>

            {/* Class Search Bar */}
            <div className="mt-3 relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={classSearchQuery}
                onChange={(e) => setClassSearchQuery(e.target.value)}
                placeholder="Tìm lớp..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-xs font-semibold text-slate-750 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="max-h-[460px] space-y-2 overflow-y-auto p-3 lg:min-h-0 lg:flex-1 lg:max-h-none">
            {filteredClasses.map((classItem) => {
              const summary = payload?.summaries[classItem.id];
              const tier = getClassPriorityTier(summary, classItem.endDate);
              const teacherName = teachersById.get(String(classItem.teacherId || '')) || '';
              const isSelected = selectedClassId === classItem.id;

              // Determine badge style based on Priority Tier
              let badgeText = 'Chưa đủ';
              let badgeClass = 'bg-amber-100 text-amber-700';
              let BadgeIcon = AlertTriangle;

              if (tier === 1) {
                badgeText = 'Cần gửi';
                badgeClass = 'bg-red-100 text-red-700 animate-pulse';
                BadgeIcon = Send;
              } else if (tier === 2) {
                badgeText = 'Cần nhận xét';
                badgeClass = 'bg-amber-100 text-amber-700';
                BadgeIcon = AlertTriangle;
              } else if (tier === 3) {
                badgeText = 'Chưa đủ';
                badgeClass = 'bg-slate-100 text-slate-500';
                BadgeIcon = AlertTriangle;
              } else if (tier === 4) {
                badgeText = 'Hoàn tất';
                badgeClass = 'bg-emerald-100 text-emerald-700';
                BadgeIcon = CheckCircle2;
              }

              return (
                <button
                  type="button"
                  key={classItem.id}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedClassId(classItem.id);
                    setResults([]);
                  }}
                  className={cn(
                    'group relative w-full overflow-hidden rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-200',
                    isSelected
                      ? 'border-blue-500 bg-blue-50/80 shadow-[0_14px_34px_rgba(37,99,235,0.13)]'
                      : 'border-transparent bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)] hover:border-blue-100 hover:bg-slate-50'
                  )}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-3 h-[calc(100%-1.5rem)] w-1 rounded-r-full bg-blue-600" />
                  )}
                  <div className="flex items-start justify-between gap-3 pl-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold leading-5 text-slate-950">
                        {classItem.name}
                      </p>
                      {teacherName && (
                        <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                          {teacherName}
                        </p>
                      )}
                      <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {formatCourseDate(classItem.startDate)} –{' '}
                        {formatCourseDate(classItem.endDate)}
                      </p>
                      <p className="mt-1.5 text-xs font-bold text-slate-650">
                        {summary?.finalEvaluationCount || 0}/{summary?.eligibleStudentCount || 0}{' '}
                        nhận xét
                      </p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold',
                        badgeClass
                      )}
                    >
                      <BadgeIcon className="h-3 w-3 shrink-0" />
                      {badgeText}
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        tier === 4 ? 'bg-emerald-500' : 'bg-blue-500'
                      )}
                      style={{
                        width: formatPercent(
                          summary?.finalEvaluationCount,
                          summary?.eligibleStudentCount
                        ),
                      }}
                    />
                  </div>
                </button>
              );
            })}
            {filteredClasses.length === 0 && (
              <div className="text-center p-4 text-xs font-semibold text-slate-400">
                Không tìm thấy lớp học.
              </div>
            )}
          </div>
        </aside>

        {/* Right main column content */}
        <section className="min-w-0 space-y-5">
          {selectedClass && selectedSummary ? (
            <>
              {/* Header Navigation Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClassId('');
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-blue-600 transition"
                  >
                    <span>&lt; Khóa học</span>
                  </button>
                  <span className="text-slate-350">|</span>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Đang chọn lớp"
                      onClick={() => setSelectedClassDropdownOpen(!selectedClassDropdownOpen)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900 shadow-sm hover:bg-slate-50 transition"
                    >
                      <span>{selectedClass.name}</span>
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    </button>

                    {selectedClassDropdownOpen && (
                      <div className="absolute left-0 mt-1 z-35 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-lg max-h-60 overflow-y-auto">
                        {classes.map((cls) => (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() => {
                              setSelectedClassId(cls.id);
                              setSelectedClassDropdownOpen(false);
                              setResults([]);
                            }}
                            className={cn(
                              'w-full rounded-lg px-3 py-2 text-left text-xs font-bold transition',
                              cls.id === selectedClassId
                                ? 'bg-blue-50 text-blue-600'
                                : 'text-slate-700 hover:bg-slate-50'
                            )}
                          >
                            {cls.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedClass.startDate && (
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                      Thời gian: {formatCourseDate(selectedClass.startDate)} –{' '}
                      {formatCourseDate(selectedClass.endDate)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* Notification bell button */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Thông báo"
                      onClick={() => setNotificationsDropdownOpen(!notificationsDropdownOpen)}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg border bg-white transition hover:text-slate-800',
                        notificationsDropdownOpen
                          ? 'border-blue-200 text-blue-600 shadow-sm'
                          : 'border-slate-200 text-slate-500'
                      )}
                    >
                      <Bell className="h-4.5 w-4.5" />
                      {dynamicNotifications.length > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white ring-2 ring-white">
                          {dynamicNotifications.length}
                        </span>
                      )}
                    </button>

                    {notificationsDropdownOpen && (
                      <div className="absolute right-0 mt-2 z-40 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl space-y-3 text-left">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <h4 className="text-xs font-black text-slate-900">Thông báo mới nhận</h4>
                          {dynamicNotifications.length > 0 ? (
                            <span className="text-[10px] bg-red-50 text-red-650 px-1.5 py-0.5 rounded-full font-bold">
                              {dynamicNotifications.length} mới
                            </span>
                          ) : (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">
                              Ổn định
                            </span>
                          )}
                        </div>
                        <div className="space-y-2.5 max-h-64 overflow-y-auto">
                          {dynamicNotifications.length > 0 ? (
                            dynamicNotifications.map((notif) => {
                              let toneClass = 'bg-blue-50 text-blue-600 ring-1 ring-blue-100';
                              let Icon = Send;

                              if (notif.type === 'success') {
                                toneClass =
                                  'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100';
                                Icon = CheckCircle2;
                              } else if (notif.type === 'warning') {
                                toneClass = 'bg-red-50 text-red-600 ring-1 ring-red-100';
                                Icon = AlertTriangle;
                              }

                              return (
                                <div
                                  key={notif.id}
                                  className="flex gap-2.5 rounded-lg p-2 hover:bg-slate-50 transition cursor-pointer"
                                >
                                  <div
                                    className={cn(
                                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                                      toneClass
                                    )}
                                  >
                                    <Icon className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-extrabold text-slate-900 leading-snug">
                                      {notif.title}
                                    </p>
                                    <p className="text-[10px] text-slate-505 font-medium leading-normal mt-0.5">
                                      {notif.description}
                                    </p>
                                    <span className="text-[9px] text-slate-400 font-bold mt-1 block">
                                      {notif.time}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                              <CheckCircle2
                                className="h-8 w-8 text-emerald-500 mb-2"
                                strokeWidth={1.5}
                              />
                              <p className="text-xs font-black text-slate-800">Hệ thống ổn định</p>
                              <p className="text-[10px] text-slate-500 font-medium leading-normal mt-0.5">
                                Không có cảnh báo thiếu nhận xét hay lỗi gửi Zalo mới nào của các
                                lớp.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(actionLoading) || academicQuery.isFetching}
                    onClick={() => void loadAcademic(true)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <RefreshCw
                      className={cn(
                        'h-3.5 w-3.5',
                        academicQuery.isFetching && 'animate-spin text-blue-600'
                      )}
                    />
                    <span>Làm mới</span>
                  </button>
                </div>
              </div>

              {/* 5-Column Metrics Row */}
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                {/* Metric 1: Total Students */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Tổng học sinh
                    </p>
                    <p className="text-lg font-black text-slate-900 mt-0.5">
                      {selectedStudents.length}
                    </p>
                  </div>
                </div>

                {/* Metric 2: Completed Comments */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                      <MessageCircle className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Đã nhận xét
                      </p>
                      <p className="text-lg font-black text-slate-900 mt-0.5">
                        {selectedSummary.finalEvaluationCount}/
                        {selectedSummary.eligibleStudentCount}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-450">
                      <span>Đã hoàn thành</span>
                      <span>
                        {formatPercent(
                          selectedSummary.finalEvaluationCount,
                          selectedSummary.eligibleStudentCount
                        )}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{
                          width: formatPercent(
                            selectedSummary.finalEvaluationCount,
                            selectedSummary.eligibleStudentCount
                          ),
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Metric 3: Sent Tuition */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                      <Wallet className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Đã gửi học phí
                      </p>
                      <p className="text-lg font-black text-slate-900 mt-0.5">
                        {selectedSummary.tuitionNoticeSentCount}/
                        {selectedSummary.eligibleStudentCount}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-450">
                      <span>Đã hoàn thành</span>
                      <span>
                        {formatPercent(
                          selectedSummary.tuitionNoticeSentCount,
                          selectedSummary.eligibleStudentCount
                        )}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{
                          width: formatPercent(
                            selectedSummary.tuitionNoticeSentCount,
                            selectedSummary.eligibleStudentCount
                          ),
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Metric 4: Pending Comments */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-100">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Chưa nhận xét
                    </p>
                    <p className="text-lg font-black text-slate-900 mt-0.5">
                      {selectedSummary.missingEvaluationStudentIds.length}
                    </p>
                  </div>
                </div>

                {/* Metric 5: Zalo Sends Failed */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Lỗi gửi
                    </p>
                    <p className="text-lg font-black text-slate-900 mt-0.5">
                      {selectedSummary.failedNotificationCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tab Navigation */}
              <div className="flex border-b border-slate-200 bg-slate-50/50 px-5 pt-2 rounded-t-xl">
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className={cn(
                    'px-6 py-3 text-sm font-bold border-b-2 -mb-px transition-all duration-200',
                    activeTab === 'overview'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  )}
                >
                  Tổng quan khóa học
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('students')}
                  className={cn(
                    'px-6 py-3 text-sm font-bold border-b-2 -mb-px transition-all duration-200',
                    activeTab === 'students'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  )}
                >
                  Danh sách học sinh ({selectedStudents.length})
                </button>
              </div>

              {activeTab === 'overview' ? (
                /* Tab 1: Overview Content */
                <div className="space-y-5">
                  {/* Side-by-Side widgets */}
                  <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                    {/* Left Card: Quick Actions */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                      <div>
                        <h3 className="text-sm font-extrabold text-slate-950 flex items-center gap-2">
                          <Zap className="h-4.5 w-4.5 text-blue-600" />
                          Thao tác nhanh
                        </h3>
                        <p className="text-xs text-slate-500 font-medium">
                          Gửi thông báo cho phụ huynh
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        {/* Gửi nhận xét */}
                        <button
                          type="button"
                          aria-label="Gửi nhận xét hàng loạt"
                          aria-busy={classEvaluationLoading}
                          disabled={
                            Boolean(actionLoading) || !selectedSummary.courseClosing.approvalValid
                          }
                          onClick={() => void runBatch('evaluation')}
                          className="group flex flex-col items-center justify-center rounded-xl bg-blue-600 p-4 text-center text-white shadow-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 group-hover:scale-110 transition">
                            {classEvaluationLoading ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <MessageCircle className="h-5 w-5" />
                            )}
                          </div>
                          <span className="mt-2 text-xs font-extrabold">Gửi nhận xét</span>
                          <span className="mt-1 text-[9px] opacity-80 font-medium leading-tight">
                            Gửi nhận xét đến phụ huynh
                          </span>
                        </button>

                        {/* Gửi học phí */}
                        <button
                          type="button"
                          aria-label="Gửi học phí hàng loạt"
                          aria-busy={classTuitionLoading}
                          disabled={
                            Boolean(actionLoading) || !selectedSummary.courseClosing.approvalValid
                          }
                          onClick={() => void runBatch('tuition')}
                          className="group flex flex-col items-center justify-center rounded-xl bg-[#0284c7] p-4 text-center text-white shadow-md hover:bg-[#0369a1] disabled:cursor-not-allowed disabled:opacity-50 transition"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 group-hover:scale-110 transition">
                            {classTuitionLoading ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Wallet className="h-5 w-5" />
                            )}
                          </div>
                          <span className="mt-2 text-xs font-extrabold">Gửi học phí</span>
                          <span className="mt-1 text-[9px] opacity-80 font-medium leading-tight">
                            Gửi thông báo học phí
                          </span>
                        </button>

                        {/* Gửi tất cả */}
                        <button
                          type="button"
                          aria-label="Gửi cả nhận xét & học phí"
                          aria-busy={classBothLoading}
                          disabled={
                            Boolean(actionLoading) || !selectedSummary.courseClosing.approvalValid
                          }
                          onClick={() => void runBatch('both')}
                          className="group flex flex-col items-center justify-center rounded-xl bg-slate-900 p-4 text-center text-white shadow-md hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 transition"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 group-hover:scale-110 transition">
                            {classBothLoading ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Send className="h-5 w-5" />
                            )}
                          </div>
                          <span className="mt-2 text-xs font-extrabold">Gửi tất cả</span>
                          <span className="mt-1 text-[9px] opacity-80 font-medium leading-tight">
                            Gửi cả nhận xét & học phí
                          </span>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                          Trạng thái chốt khóa
                        </span>
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold',
                            selectedSummary.courseClosing.status === 'completed'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : selectedSummary.courseClosing.approvalValid
                                ? 'border-blue-200 bg-blue-50 text-blue-800'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                          )}
                        >
                          {t.courseClosing.statuses[selectedSummary.courseClosing.status]}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {`Nhận xét ${selectedSummary.courseClosing.evaluationSentCount}/${selectedSummary.courseClosing.requiredStudentCount}`}
                          {` · Hạng ${selectedSummary.courseClosing.rankSentCount}/${selectedSummary.courseClosing.rankRequiredCount}`}
                          {` · Học phí ${selectedSummary.courseClosing.tuitionSentCount}/${selectedSummary.courseClosing.requiredStudentCount}`}
                        </span>
                      </div>

                      {!selectedSummary.courseClosing.approvalValid && (
                        <p className="text-[11px] font-bold text-amber-705 flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg p-3">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {courseClosingBlockerMessage(selectedSummary.courseClosing)}
                        </p>
                      )}
                    </div>

                    {/* Right Card: Needs Action / Warnings */}
                    <div
                      className={cn(
                        'rounded-xl border p-5 shadow-sm flex flex-col justify-between gap-3',
                        selectedSummary.missingEvaluationStudentIds.length > 0
                          ? 'bg-red-50/40 border-red-100 text-red-950'
                          : 'bg-emerald-50/40 border-emerald-100 text-emerald-950'
                      )}
                    >
                      <div>
                        <h3 className="text-sm font-extrabold flex items-center gap-2">
                          <AlertTriangle
                            className={cn(
                              'h-4.5 w-4.5 shrink-0',
                              selectedSummary.missingEvaluationStudentIds.length > 0
                                ? 'text-red-650'
                                : 'text-emerald-600'
                            )}
                          />
                          CẦN XỬ LÝ GẤP
                        </h3>
                        <p className="mt-1 text-xs opacity-85 font-semibold">
                          {selectedSummary.missingEvaluationStudentIds.length > 0
                            ? `${selectedSummary.missingEvaluationStudentIds.length} học sinh chưa nhận xét`
                            : 'Tất cả nhận xét của lớp đã hoàn thành!'}
                        </p>
                      </div>

                      {selectedSummary.missingEvaluationStudentIds.length > 0 ? (
                        <div className="space-y-2">
                          <ul className="list-disc pl-5 text-xs font-bold space-y-1">
                            {selectedSummary.missingEvaluationStudentIds.slice(0, 3).map((id) => (
                              <li key={id}>{studentNamesMap.get(id) || id}</li>
                            ))}
                          </ul>
                          {selectedSummary.missingEvaluationStudentIds.length > 3 && (
                            <p className="text-[11px] opacity-75 font-semibold pl-1">
                              + {selectedSummary.missingEvaluationStudentIds.length - 3} học sinh
                              khác
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab('students');
                              setStudentFilter('no_eval');
                            }}
                            className="text-xs font-extrabold text-amber-705 hover:underline transition self-start block"
                          >
                            Xem tất cả &gt;
                          </button>
                        </div>
                      ) : (
                        <div className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          Tuyệt vời! Tất cả công việc học vụ của lớp này đã hoàn thành 100%!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Course Fee Info Banner */}
                  <div className="flex flex-col gap-4 rounded-xl border border-blue-100 bg-blue-50/40 p-5 shadow-inner">
                    <div className="flex gap-3">
                      <Info className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-slate-700">
                          Học phí quy định khóa học:{' '}
                          <span className="font-extrabold text-blue-700">
                            {currencyFormatter.format(Number(selectedClass.tuitionFee || 0))} VND
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-slate-500 leading-normal font-medium">
                          Lưu ý: Học vụ cần đảm bảo việc hoàn tất đầy đủ nhận xét học tập và thông
                          báo học phí gửi đến phụ huynh trước ngày kết khóa học để tối ưu hóa quy
                          trình thu phí và vận hành của trung tâm.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Tab 2: Students Content */
                <div className="space-y-4">
                  {/* Toolbar & Directory Tabs */}
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    {/* Inner completed/pending navigation tabs */}
                    <div className="flex border-b border-slate-200 -mx-5 px-5">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDirectoryTab('pending');
                          setStudentFilter('all');
                        }}
                        className={cn(
                          'px-5 py-3 text-xs font-extrabold border-b-2 -mb-px transition-all duration-200',
                          activeDirectoryTab === 'pending'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        )}
                      >
                        Đang xử lý
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDirectoryTab('completed');
                          setStudentFilter('all');
                        }}
                        className={cn(
                          'px-5 py-3 text-xs font-extrabold border-b-2 -mb-px transition-all duration-200',
                          activeDirectoryTab === 'completed'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        )}
                      >
                        Đã hoàn thành
                      </button>
                    </div>

                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-600" />
                        <h3 className="text-sm font-extrabold text-slate-900">
                          {activeDirectoryTab === 'pending' ? 'Học sinh' : 'Đã hoàn tất'}
                        </h3>
                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full font-bold text-slate-500">
                          Đang hiển thị {displayStudents.length} / {selectedStudents.length}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 items-center">
                        {/* Search student */}
                        <div className="relative w-full sm:w-48">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={studentSearchQuery}
                            onChange={(e) => setStudentSearchQuery(e.target.value)}
                            placeholder="Tìm học sinh..."
                            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        {/* Filter student status */}
                        <select
                          value={studentFilter}
                          onChange={(e) => setStudentFilter(e.target.value as any)}
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-750 outline-none focus:border-blue-500"
                        >
                          <option value="all">Tất cả trạng thái</option>
                          <option value="no_eval">Chưa có nhận xét</option>
                          <option value="unsent_eval">Chưa gửi nhận xét Zalo</option>
                          <option value="unsent_tuition">Chưa gửi thông báo học phí</option>
                          <option value="failed">Lỗi gửi gần đây</option>
                        </select>

                        {/* Grid vs Table Toggles */}
                        <div className="flex items-center gap-1.5 bg-slate-100 p-0.5 rounded-lg">
                          <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            className={cn(
                              'p-1.5 rounded-md transition',
                              viewMode === 'grid'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                            )}
                            title="Xem dạng thẻ"
                          >
                            <LayoutGrid className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={cn(
                              'p-1.5 rounded-md transition',
                              viewMode === 'table'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                            )}
                            title="Xem dạng bảng"
                          >
                            <ListIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Display Student Cards or Table */}
                    {viewMode === 'grid' ? (
                      displayStudents.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                          {displayStudents.map((student) => {
                            const finalEvaluation = selectFinalEvaluation(
                              evaluationsByStudent.get(student.id) || []
                            );
                            const actionState = getStudentActionState({
                              student,
                              finalEvaluation,
                              sentSets,
                              selectedSummary,
                              actionLoading,
                            });
                            const {
                              rank,
                              onLeaveMissingEvaluation,
                              evaluationSent,
                              tuitionSent,
                              evaluationActionDisabled,
                              tuitionActionDisabled,
                              bothActionDisabled,
                              rankActionDisabled,
                              evaluationActionTitle,
                              tuitionActionTitle,
                              rankActionTitle,
                            } = actionState;
                            const evaluationLoading =
                              actionLoading === studentActionKey('evaluation', student.id);
                            const rankLoading =
                              actionLoading === studentActionKey('rank', student.id);
                            const tuitionLoading =
                              actionLoading === studentActionKey('tuition', student.id);
                            const bothLoading =
                              actionLoading === studentActionKey('both', student.id);

                            // Initials for avatar
                            const nameParts = student.name.split(' ');
                            const initials =
                              nameParts
                                .slice(-2)
                                .map((n) => n[0])
                                .join('')
                                .toUpperCase() || student.name.substring(0, 2).toUpperCase();

                            // Color selection based on student name hash
                            const hash = student.name
                              .split('')
                              .reduce((acc, char) => char.charCodeAt(0) + acc, 0);
                            const colors = [
                              'bg-blue-50 text-blue-600 border border-blue-150',
                              'bg-emerald-50 text-emerald-600 border border-emerald-150',
                              'bg-amber-50 text-amber-600 border border-amber-150',
                              'bg-indigo-50 text-indigo-600 border border-indigo-150',
                              'bg-purple-50 text-purple-600 border border-purple-150',
                              'bg-sky-50 text-sky-600 border border-sky-150',
                            ];
                            const avatarColor = colors[hash % colors.length];

                            return (
                              <div
                                key={student.id}
                                className="flex flex-col justify-between rounded-xl border border-slate-205 bg-white p-4 shadow-[0_4px_12px_rgba(0,0,0,0.02)] hover:border-blue-300 hover:shadow-[0_10px_20px_rgba(37,99,235,0.05)] transition duration-200"
                              >
                                <div className="space-y-3">
                                  {/* Identity and code */}
                                  <div className="flex items-center gap-3">
                                    <div
                                      className={cn(
                                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black',
                                        avatarColor
                                      )}
                                    >
                                      {initials}
                                    </div>
                                    <div className="min-w-0">
                                      <h4 className="font-extrabold text-slate-900 truncate text-sm">
                                        {student.name}
                                      </h4>
                                      <p className="text-[11px] font-semibold text-slate-400">
                                        {student.contact || 'Chưa có SĐT'} · {student.studentId}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Dot status badges */}
                                  <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                                    <span
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border',
                                        finalEvaluation
                                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                          : 'bg-amber-50 text-amber-700 border-amber-100 animate-pulse'
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          'h-1.5 w-1.5 rounded-full',
                                          finalEvaluation ? 'bg-emerald-500' : 'bg-amber-500'
                                        )}
                                      />
                                      {finalEvaluation ? 'Đã có nhận xét' : 'Chưa nhận xét'}
                                    </span>

                                    <span
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border',
                                        evaluationSent
                                          ? 'bg-blue-50 text-blue-700 border-blue-100'
                                          : 'bg-slate-100 text-slate-600 border-slate-200'
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          'h-1.5 w-1.5 rounded-full',
                                          evaluationSent ? 'bg-blue-500' : 'bg-slate-400'
                                        )}
                                      />
                                      Zalo NX: {evaluationSent ? 'Đã gửi' : 'Chưa gửi'}
                                    </span>

                                    <span
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border',
                                        tuitionSent
                                          ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                          : 'bg-slate-100 text-slate-600 border-slate-200'
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          'h-1.5 w-1.5 rounded-full',
                                          tuitionSent ? 'bg-indigo-500' : 'bg-slate-400'
                                        )}
                                      />
                                      Zalo Phí: {tuitionSent ? 'Đã gửi' : 'Chưa gửi'}
                                    </span>
                                  </div>

                                  {/* Final comments summary inside card */}
                                  <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 font-medium border border-slate-100">
                                    {finalEvaluation ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between font-extrabold text-slate-900">
                                          <span>Nhận xét cuối</span>
                                          <span className="text-blue-600 text-[10px] bg-blue-50 px-1.5 rounded-md">
                                            Điểm: {scoreFromEvaluation(finalEvaluation)}
                                          </span>
                                        </div>
                                        <p className="truncate text-slate-500">
                                          ➕{' '}
                                          {textFromValue(finalEvaluation.positivePoints) ||
                                            'Chưa cập nhật ưu điểm'}
                                        </p>
                                        <p className="truncate text-slate-400">
                                          🔧{' '}
                                          {textFromValue(finalEvaluation.improvementPoints) ||
                                            'Chưa cập nhật nhược điểm'}
                                        </p>
                                      </div>
                                    ) : onLeaveMissingEvaluation ? (
                                      <p className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
                                        <Info className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                        {ON_LEAVE_MISSING_EVALUATION_REASON}
                                      </p>
                                    ) : (
                                      <p className="font-bold text-amber-700 flex items-center gap-1 text-[11px]">
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                        Chưa có nhận xét cuối khóa
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Row Card buttons */}
                                <div className="mt-4 grid grid-cols-2 gap-1 border-t border-slate-100 pt-3 sm:grid-cols-4">
                                  <button
                                    type="button"
                                    data-testid={`academic-student-${student.id}-send-evaluation`}
                                    title={evaluationActionTitle}
                                    disabled={evaluationActionDisabled}
                                    onClick={() => void runBatch('evaluation', [student])}
                                    className="flex-1 inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[#edf2ff] px-2 text-[11px] font-extrabold text-[#3b82f6] transition hover:bg-[#e0e7ff] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
                                  >
                                    {evaluationLoading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Send className="h-3 w-3" />
                                    )}
                                    <span>Gửi nhận xét</span>
                                  </button>

                                  <button
                                    type="button"
                                    data-testid={`academic-student-${student.id}-send-rank`}
                                    title={rankActionTitle}
                                    disabled={rankActionDisabled}
                                    onClick={() => void runBatch('rank', [student])}
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[#fef3c7] px-2 text-[11px] font-extrabold text-[#b45309] transition hover:bg-[#fde68a] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
                                  >
                                    {rankLoading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Award className="h-3 w-3" />
                                    )}
                                    <span>Gửi hạng</span>
                                  </button>

                                  <button
                                    type="button"
                                    data-testid={`academic-student-${student.id}-send-tuition`}
                                    title={tuitionActionTitle}
                                    disabled={tuitionActionDisabled}
                                    onClick={() => void runBatch('tuition', [student])}
                                    className="flex-1 inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[#e0f2fe] px-2 text-[11px] font-extrabold text-[#0284c7] transition hover:bg-[#bae6fd] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25"
                                  >
                                    {tuitionLoading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Wallet className="h-3 w-3" />
                                    )}
                                    <span>Gửi học phí</span>
                                  </button>

                                  <button
                                    type="button"
                                    data-testid={`academic-student-${student.id}-send-both`}
                                    title={evaluationActionTitle}
                                    disabled={bothActionDisabled}
                                    onClick={() => void runBatch('both', [student])}
                                    className="flex-1 inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[#f1f5f9] px-2 text-[11px] font-extrabold text-[#475569] transition hover:bg-[#e2e8f0] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700/80 dark:text-slate-200 dark:hover:bg-slate-700"
                                  >
                                    {bothLoading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Send className="h-3.5 w-3.5" />
                                    )}
                                    <span>Cả 2</span>
                                  </button>
                                </div>
                                {actionState.exemptionReason ? (
                                  <p className="mt-2 text-[11px] font-semibold text-amber-700">
                                    {t.courseClosing.exemption.exemptReason.replace(
                                      '{reason}',
                                      actionState.exemptionReason
                                    )}
                                  </p>
                                ) : (
                                  isAdmin &&
                                  selectedSummary.courseClosing.approvalValid &&
                                  !actionState.completed && (
                                    <button
                                      type="button"
                                      data-testid={`academic-student-${student.id}-exempt-card`}
                                      onClick={() =>
                                        setExemptionTarget({
                                          studentId: student.id,
                                          studentName: student.name,
                                        })
                                      }
                                      className="mt-2 inline-flex h-7 items-center justify-center rounded-lg border border-amber-300 bg-white px-2 text-[11px] font-extrabold text-amber-700 hover:bg-amber-50"
                                    >
                                      {t.courseClosing.exemption.action}
                                    </button>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-10 text-xs font-semibold text-slate-400">
                          Không tìm thấy học sinh phù hợp với bộ lọc.
                        </div>
                      )
                    ) : (
                      /* Table View (Alternative) */
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[980px] table-fixed text-left text-sm">
                            <colgroup>
                              <col className="w-[5%]" />
                              <col className="w-[18%]" />
                              <col className="w-[18%]" />
                              <col className="w-[18%]" />
                              <col className="w-[29%]" />
                              <col className="w-[12%]" />
                            </colgroup>
                            <thead className="bg-slate-50 text-xs font-extrabold uppercase text-slate-500">
                              <tr>
                                <th className="px-5 py-4">#</th>
                                <th className="px-5 py-4">Học sinh</th>
                                <th className="px-5 py-4">Trạng thái nhận xét</th>
                                <th className="px-5 py-4">Trạng thái học phí</th>
                                <th className="px-5 py-4">Nhận xét cuối</th>
                                <th className="px-5 py-4">Thao tác</th>
                              </tr>
                            </thead>
                            {displayStudents.length > 0 ? (
                              <tbody className="divide-y divide-slate-100">
                                {displayStudents.map((student, index) => {
                                  const finalEvaluation = selectFinalEvaluation(
                                    evaluationsByStudent.get(student.id) || []
                                  );
                                  const actionState = getStudentActionState({
                                    student,
                                    finalEvaluation,
                                    sentSets,
                                    selectedSummary,
                                    actionLoading,
                                  });
                                  const {
                                    rank,
                                    onLeaveMissingEvaluation,
                                    evaluationSent,
                                    tuitionSent,
                                    evaluationActionDisabled,
                                    tuitionActionDisabled,
                                    bothActionDisabled,
                                    rankActionDisabled,
                                    evaluationActionTitle,
                                    tuitionActionTitle,
                                    rankActionTitle,
                                  } = actionState;
                                  const evaluationLoading =
                                    actionLoading === studentActionKey('evaluation', student.id);
                                  const rankLoading =
                                    actionLoading === studentActionKey('rank', student.id);
                                  const tuitionLoading =
                                    actionLoading === studentActionKey('tuition', student.id);
                                  const bothLoading =
                                    actionLoading === studentActionKey('both', student.id);
                                  return (
                                    <tr key={student.id} className="align-top hover:bg-slate-50/70">
                                      <td className="px-5 py-4 font-bold text-slate-400">
                                        {index + 1}
                                      </td>
                                      <td className="px-5 py-4">
                                        <p className="font-extrabold text-slate-900">
                                          {student.name}
                                        </p>
                                        <p className="mt-1 text-xs font-medium text-slate-500">
                                          {student.studentId}
                                        </p>
                                        <p className="mt-1 text-xs font-medium text-slate-400">
                                          {normalizeAcademicEnrollmentStatus(
                                            student.enrollmentStatus
                                          ) === 'on_leave'
                                            ? 'Tạm nghỉ'
                                            : 'Active'}
                                        </p>
                                      </td>
                                      <td className="px-5 py-4">
                                        <span
                                          className={cn(
                                            'inline-flex rounded-full px-2.5 py-1 text-xs font-bold',
                                            finalEvaluation
                                              ? 'bg-emerald-50 text-emerald-700'
                                              : 'bg-amber-50 text-amber-700'
                                          )}
                                        >
                                          {finalEvaluation ? 'Đã có nhận xét' : 'Chưa có nhận xét'}
                                        </span>
                                        <p className="mt-2 text-xs font-medium text-slate-500">
                                          Zalo: {evaluationSent ? 'đã gửi' : 'chưa gửi'}
                                        </p>
                                      </td>
                                      <td className="px-5 py-4">
                                        <span
                                          className={cn(
                                            'inline-flex rounded-full px-2.5 py-1 text-xs font-bold',
                                            tuitionSent
                                              ? 'bg-emerald-50 text-emerald-700'
                                              : 'bg-slate-100 text-slate-600'
                                          )}
                                        >
                                          {tuitionSent ? 'Đã gửi phí' : 'Chưa gửi phí'}
                                        </span>
                                      </td>
                                      <td className="px-5 py-4 text-slate-650">
                                        {finalEvaluation ? (
                                          <div className="space-y-1">
                                            <p className="font-bold text-slate-900">
                                              Điểm: {scoreFromEvaluation(finalEvaluation)}
                                            </p>
                                            <p>{textFromValue(finalEvaluation.positivePoints)}</p>
                                            <p>
                                              {textFromValue(finalEvaluation.improvementPoints)}
                                            </p>
                                          </div>
                                        ) : onLeaveMissingEvaluation ? (
                                          <span className="font-semibold text-slate-600">
                                            {ON_LEAVE_MISSING_EVALUATION_REASON}
                                          </span>
                                        ) : (
                                          <span className="font-semibold text-amber-700">
                                            Chưa có nhận xét
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-5 py-4">
                                        <div className="flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            data-testid={`academic-student-${student.id}-send-evaluation`}
                                            aria-label={`Gửi nhận xét cho ${student.name}`}
                                            title={evaluationActionTitle}
                                            disabled={evaluationActionDisabled}
                                            onClick={() => void runBatch('evaluation', [student])}
                                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {evaluationLoading ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <Send className="h-3.5 w-3.5" />
                                            )}
                                            Gửi NX
                                          </button>
                                          <button
                                            type="button"
                                            data-testid={`academic-student-${student.id}-send-rank`}
                                            aria-label={`Gửi thông báo hạng cho ${student.name}`}
                                            title={rankActionTitle}
                                            disabled={rankActionDisabled}
                                            onClick={() => void runBatch('rank', [student])}
                                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {rankLoading ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <Award className="h-3.5 w-3.5" />
                                            )}
                                            Gửi hạng
                                          </button>
                                          <button
                                            type="button"
                                            data-testid={`academic-student-${student.id}-send-tuition`}
                                            aria-label={`Gửi thông báo học phí cho ${student.name}`}
                                            title={tuitionActionTitle}
                                            disabled={tuitionActionDisabled}
                                            onClick={() => void runBatch('tuition', [student])}
                                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-900 px-2 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {tuitionLoading ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <Wallet className="h-3.5 w-3.5" />
                                            )}
                                            Gửi phí
                                          </button>
                                          <button
                                            type="button"
                                            data-testid={`academic-student-${student.id}-send-both`}
                                            aria-label={`Gửi nhận xét và thông báo học phí cho ${student.name}`}
                                            title={evaluationActionTitle}
                                            disabled={bothActionDisabled}
                                            onClick={() => void runBatch('both', [student])}
                                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {bothLoading ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <Send className="h-3.5 w-3.5" />
                                            )}
                                            Cả 2
                                          </button>
                                          {isAdmin &&
                                            !actionState.exemptionReason &&
                                            selectedSummary.courseClosing.approvalValid &&
                                            !actionState.completed && (
                                              <button
                                                type="button"
                                                data-testid={`academic-student-${student.id}-exempt`}
                                                onClick={() =>
                                                  setExemptionTarget({
                                                    studentId: student.id,
                                                    studentName: student.name,
                                                  })
                                                }
                                                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50"
                                              >
                                                {t.courseClosing.exemption.action}
                                              </button>
                                            )}
                                        </div>
                                        {actionState.exemptionReason && (
                                          <p className="mt-2 text-xs font-semibold text-amber-700">
                                            {t.courseClosing.exemption.exemptReason.replace(
                                              '{reason}',
                                              actionState.exemptionReason
                                            )}
                                          </p>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            ) : null}
                          </table>
                        </div>
                        {displayStudents.length === 0 && <EmptyStudentsState />}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Batch results log */}
              {results.length > 0 && (
                <div className="mt-5 border-t border-slate-200 bg-white p-5 space-y-3 rounded-b-xl">
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                    Kết quả xử lý gửi hàng loạt vừa thực hiện
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left text-sm">
                      <thead className="text-xs font-extrabold uppercase text-slate-500 bg-slate-50/50">
                        <tr>
                          <th className="py-2.5 px-3">Học sinh</th>
                          <th className="py-2.5 px-3">Nhận xét</th>
                          <th className="py-2.5 px-3">Hạng</th>
                          <th className="py-2.5 px-3">Học phí</th>
                          <th className="py-2.5 px-3">Chi tiết lỗi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {results.map((result) => (
                          <tr key={result.studentId} className="hover:bg-slate-50/40">
                            <td className="py-2.5 px-3 font-bold text-slate-900">
                              {result.studentName}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  'inline-flex rounded px-1.5 py-0.5 text-xs font-bold',
                                  result.evaluation === 'sent' && 'bg-emerald-50 text-emerald-700',
                                  result.evaluation === 'skipped' && 'bg-slate-100 text-slate-500',
                                  result.evaluation === 'failed' && 'bg-red-50 text-red-700'
                                )}
                              >
                                {result.evaluation === 'sent' && 'Đã gửi'}
                                {result.evaluation === 'skipped' && 'Bỏ qua'}
                                {result.evaluation === 'failed' && 'Lỗi'}
                                {result.evaluation === '-' && '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  'inline-flex rounded px-1.5 py-0.5 text-xs font-bold',
                                  result.rank === 'sent' && 'bg-emerald-50 text-emerald-700',
                                  result.rank === 'skipped' && 'bg-slate-100 text-slate-500',
                                  result.rank === 'failed' && 'bg-red-50 text-red-700'
                                )}
                              >
                                {result.rank === 'sent' && 'Đã gửi hạng'}
                                {result.rank === 'skipped' && 'Bỏ qua hạng'}
                                {result.rank === 'failed' && 'Lỗi hạng'}
                                {result.rank === '-' && '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  'inline-flex rounded px-1.5 py-0.5 text-xs font-bold',
                                  result.tuition === 'sent' && 'bg-emerald-50 text-emerald-700',
                                  result.tuition === 'skipped' && 'bg-slate-100 text-slate-500',
                                  result.tuition === 'failed' && 'bg-red-50 text-red-700'
                                )}
                              >
                                {result.tuition === 'sent' && 'Đã gửi'}
                                {result.tuition === 'skipped' && 'Bỏ qua'}
                                {result.tuition === 'failed' && 'Lỗi'}
                                {result.tuition === '-' && '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-xs font-bold text-red-650">
                              {result.error || ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-[520px] items-center justify-center p-8 text-center text-sm font-medium text-slate-500">
              Chưa có lớp để hiển thị.
            </div>
          )}
        </section>
      </div>

      {isAdmin && exemptionTarget && selectedClass && (
        <CourseClosingExemptionModal
          classId={selectedClass.id}
          studentId={exemptionTarget.studentId}
          studentName={exemptionTarget.studentName}
          onClose={() => setExemptionTarget(null)}
          onSuccess={() => {
            setExemptionTarget(null);
            // Refetch so every gate re-derives from the new server snapshot.
            void loadAcademic(true);
          }}
        />
      )}
    </div>
  );
}
