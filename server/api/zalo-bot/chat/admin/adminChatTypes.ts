import type {
  AdminChatIntent,
  AdminFinanceMetric,
  AdminGroupByScope,
  AdminHeadcountState,
  AdminRankingBand,
  AdminRankingCriterion,
  AdminTuitionStatus,
  AllChatIntent,
  BaseChatIntent,
  ResolvedPeriodBounds,
} from '../../../../../shared/adminChatMetrics.js';
import type { CanonicalStudentPlacementStatus } from '../../../../../shared/canonicalStudentReadModel.js';

export type {
  AdminChatIntent,
  AdminFinanceMetric,
  AdminGroupByScope,
  AdminHeadcountState,
  AdminRankingBand,
  AdminRankingCriterion,
  AdminTuitionStatus,
  AllChatIntent,
  BaseChatIntent,
  ResolvedPeriodBounds,
};

export type AdminQuestion = {
  intent: AllChatIntent;
  studentHint?: string | null;
  teacherHint?: string | null;
  classHint?: string | null;
  period?: string | null;
  metrics?: string[];
  ranking?: AdminRankingCriterion | null;
  groupBy?: AdminGroupByScope | null;
  courseScope?: 'current' | 'all' | null;
  limit?: number | null;
};

export type AdminDataQualityIssueCode =
  | 'stale'
  | 'truncated'
  | 'source_incomplete'
  | 'result_cap_reached';

export type AdminDataQualityIssue = {
  code: AdminDataQualityIssueCode;
  source?: string;
  omittedCount?: number;
};

export type AdminDataQuality = {
  status: 'complete' | 'degraded' | 'failed';
  issues: AdminDataQualityIssue[];
};

export type AdminCandidateItem = {
  id: string;
  fullName: string;
  code?: string;
  className?: string | null;
  teacherName?: string | null;
  statusLabel?: string;
};

// Typed Results per domain executor

export type AdminDirectoryLookupResult = {
  kind: 'directory_lookup';
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    currentClassName: string | null;
    teacherName: string | null;
    placementStatus: CanonicalStudentPlacementStatus;
  } | null;
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminPhoneResult = {
  kind: 'student_phone';
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    className: string | null;
    phone: string;
  };
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminHeadcountResult = {
  kind: 'center_headcount';
  totalCanonical: number | null;
  breakdown: Record<AdminHeadcountState, number | null>;
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminStudentTuitionResult = {
  kind: 'student_tuition';
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    className: string | null;
  };
  courseLabel: string | null;
  paymentStatus: AdminTuitionStatus;
  grossBilled: number | null;
  discountTotal: number | null;
  netBilled: number | null;
  paidTotal: number | null;
  outstandingTotal: number | null;
  dueDate: string | null;
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminCenterFinanceResult = {
  kind: 'center_finance';
  period: ResolvedPeriodBounds;
  requestedMetrics: AdminFinanceMetric[];
  grossBilled: number | null;
  netBilled: number | null;
  collectedCohort: number | null;
  cashIn: number | null;
  cashOut: number | null;
  netCashFlow: number | null;
  discount: number | null;
  waiver: number | null;
  unclassifiedReduction: number | null;
  discountTotal: number | null;
  outstanding: number | null;
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminClassTuitionResult = {
  kind: 'class_tuition';
  classId: string;
  className: string;
  teacherName: string;
  courseLabel: string;
  expectedGross: number | null;
  recordedGross: number | null;
  reductionTotal: number | null;
  netDueTotal: number | null;
  paidTotal: number | null;
  outstandingTotal: number | null;
  studentCount: number | null;
  missingLedgerCount: number | null;
  warningRowCount: number | null;
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminClassTuitionRankingRow = {
  classId: string;
  className: string;
  teacherName: string;
  netDueTotal: number | null;
  paidTotal: number | null;
  outstandingTotal: number | null;
  paidRatio: number | null;
  rankingBand: AdminRankingBand;
};

export type AdminClassTuitionRankingResult = {
  kind: 'class_tuition_ranking';
  criterion: AdminRankingCriterion;
  rows: AdminClassTuitionRankingRow[];
  omittedCount: number;
  excludedIncompleteCount: number;
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminCoursePeriodResult = {
  kind: 'class_course_period';
  classId: string;
  className: string;
  teacherName: string;
  courseId: string | null;
  courseLabel: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminTeacherPayrollClassItem = {
  classId: string;
  className: string;
  sessionCount: number;
  salary: number;
};

export type AdminTeacherPayrollResult = {
  kind: 'teacher_payroll';
  period: ResolvedPeriodBounds;
  teacherId?: string | null;
  teacherName?: string | null;
  totalSessions: number | null;
  accruedSalary: number | null;
  classBreakdown: AdminTeacherPayrollClassItem[];
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminAcademicEvaluationItem = {
  termLabel: string;
  type: 'midterm' | 'final';
  score: number | null;
  rank: string | null;
  strengths: string[];
  improvements: string[];
  date: string | null;
};

export type AdminAcademicAssignmentItem = {
  title: string;
  score: number | null;
  maxScore: number | null;
  submittedAt: string | null;
};

export type AdminAcademicResult = {
  kind: 'student_academic';
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    className: string | null;
  };
  evaluations: AdminAcademicEvaluationItem[];
  assignments: AdminAcademicAssignmentItem[];
  attendanceSummary?: {
    totalSessions: number;
    presentSessions: number;
    absentSessions: number;
  };
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminZaloOperationsResult = {
  kind: 'zalo_operations';
  period: ResolvedPeriodBounds;
  links: {
    active: number;
    disabled: number;
    needsRelink: number;
    pendingCount: number;
  };
  messages: {
    total: number;
    sent: number;
    failed: number;
    sentRate: number;
  };
  topErrors: Array<{ errorCode: string; count: number }>;
  backlogs: {
    stalePending: number;
    staleProcessing: number;
    retryQueue: number;
  };
  quality: AdminDataQuality;
  computedAt: string;
  source: string;
  sourceAsOf?: string;
};

export type AdminDisambiguationResult = {
  kind: 'admin_disambiguation';
  entityType: 'student' | 'teacher' | 'class';
  candidates: AdminCandidateItem[];
  omittedCount?: number;
};

export type AdminEntityNotFoundResult = {
  kind: 'admin_entity_not_found';
  entityType: 'student' | 'teacher' | 'class';
  hint: string;
};

export type AdminCapabilityDisabledResult = {
  kind: 'admin_capability_disabled';
  intent: AdminChatIntent;
};

export type AdminGenericErrorResult = {
  kind: 'admin_error';
  code: string;
  safeMessage: string;
};

export type AdminExecutionResult =
  | AdminDirectoryLookupResult
  | AdminPhoneResult
  | AdminHeadcountResult
  | AdminStudentTuitionResult
  | AdminCenterFinanceResult
  | AdminClassTuitionResult
  | AdminClassTuitionRankingResult
  | AdminCoursePeriodResult
  | AdminTeacherPayrollResult
  | AdminAcademicResult
  | AdminZaloOperationsResult
  | AdminDisambiguationResult
  | AdminEntityNotFoundResult
  | AdminCapabilityDisabledResult
  | AdminGenericErrorResult;

export type AdminQueryResult = AdminExecutionResult;
export type AdminStudentAcademicResult = AdminAcademicResult;
