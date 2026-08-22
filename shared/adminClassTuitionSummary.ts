import {
  deriveClassTuitionRankingBand,
  type AdminRankingBand,
  type AdminRankingCriterion,
} from './adminChatMetrics.js';

export const ADMIN_CLASS_TUITION_SNAPSHOT_VERSION = 1;
export const ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION = 'admin_class_tuition_summaries';
export const ADMIN_CLASS_TUITION_HEALTH_COLLECTION = 'admin_class_tuition_health';
export const ADMIN_CLASS_TUITION_HEALTH_DOC_ID = 'global';

export type AdminClassTuitionSummaryDoc = {
  id: string; // ${classId}__${termStart}
  classId: string;
  teacherId: string;
  courseId: string | null;
  termStart: string;
  termEnd: string | null;
  isCurrent: boolean;
  netDueTotal: number | null;
  paidTotal: number | null;
  outstandingTotal: number | null;
  paidRatio: number | null;
  rankingBand: AdminRankingBand;
  studentCount: number;
  outstandingStudentCount: number;
  missingLedgerCount: number;
  warningRowCount: number;
  complete: boolean;
  sourceVersion: number;
  generatedAt: string;
  sourceUpdatedAt: string;
};

export type AdminClassTuitionHealthDoc = {
  sourceVersion: number;
  healthy: boolean;
  expectedCount: number;
  materializedCount: number;
  completeCount: number;
  incompleteCount: number;
  oldestGeneratedAt: string | null;
  newestGeneratedAt: string | null;
  lastDailyRebuildAt: string | null;
  lastDailyRebuildStatus: 'success' | 'failed' | null;
  sourceInvalidatedAt?: string | null;
  invalidationReason?: string | null;
};

export function makeAdminClassTuitionSummaryDocId(classId: string, termStart: string): string {
  return `${classId.trim()}__${termStart.trim()}`;
}

export function computeSummaryPaidRatio(
  paidTotal: number | null | undefined,
  netDueTotal: number | null | undefined
): number | null {
  if (paidTotal == null || netDueTotal == null) return null;
  if (netDueTotal <= 0) return 0;
  return Math.round((paidTotal / netDueTotal) * 10000) / 10000;
}

export function computeSummaryRankingBand(input: {
  netDueTotal: number | null;
  paidTotal: number | null;
  outstandingTotal: number | null;
  complete: boolean;
  missingLedgerCount?: number;
  warningRowCount?: number;
}): AdminRankingBand {
  return deriveClassTuitionRankingBand(input);
}
