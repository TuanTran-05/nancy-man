import { formatInTimeZone } from 'date-fns-tz';
import { VN_TIME_ZONE } from './dateTimeFormat.js';
import { finiteMoney } from './money.js';

export const NEARLY_PAID_THRESHOLD = 0.9;
export const MAX_METRICS_PER_QUESTION = 3;
export const MAX_ADMIN_ANSWER_LENGTH = 2000;
export const MAX_ADMIN_LIST_ITEMS = 10;

export const ADMIN_CHAT_INTENTS = [
  'admin_student_lookup',
  'admin_student_phone',
  'admin_student_tuition',
  'admin_center_headcount',
  'admin_center_finance',
  'admin_class_tuition',
  'admin_class_tuition_ranking',
  'admin_class_course_period',
  'admin_teacher_payroll',
  'admin_student_academic',
  'admin_zalo_operations',
] as const;

export type AdminChatIntent = (typeof ADMIN_CHAT_INTENTS)[number];

export const BASE_CHAT_INTENTS = [
  'class_student_count',
  'class_student_list',
  'class_end_date',
  'attendance_today',
  'my_todo',
] as const;

export type BaseChatIntent = (typeof BASE_CHAT_INTENTS)[number];

export const ALL_CHAT_INTENTS = [
  ...ADMIN_CHAT_INTENTS,
  ...BASE_CHAT_INTENTS,
  'unsupported',
] as const;

export type AllChatIntent = (typeof ALL_CHAT_INTENTS)[number];

export const ADMIN_FINANCE_METRICS = [
  'gross_billed',
  'net_billed',
  'cash_in',
  'collected_cohort',
  'cash_out',
  'net_cash_flow',
  'discount',
  'waiver',
  'unclassified_reduction',
  'discount_total',
  'outstanding',
] as const;

export type AdminFinanceMetric = (typeof ADMIN_FINANCE_METRICS)[number];

export const ADMIN_HEADCOUNT_STATES = [
  'studying',
  'trial',
  'on_leave',
  'waiting_for_placement',
  'inactive',
] as const;

export type AdminHeadcountState = (typeof ADMIN_HEADCOUNT_STATES)[number];

export const ADMIN_TUITION_STATUSES = [
  'paid',
  'partial',
  'overdue',
  'unpaid',
  'missing_ledger',
  'waived',
] as const;

export type AdminTuitionStatus = (typeof ADMIN_TUITION_STATUSES)[number];

export const ADMIN_RANKING_CRITERIA = ['highest_outstanding', 'nearly_paid', 'fully_paid'] as const;

export type AdminRankingCriterion = (typeof ADMIN_RANKING_CRITERIA)[number];

export type AdminRankingBand =
  | 'no_receivable'
  | 'fully_paid'
  | 'nearly_paid'
  | 'outstanding'
  | 'incomplete';

export const ADMIN_GROUP_BY_SCOPES = ['center', 'class', 'teacher', 'student'] as const;

export type AdminGroupByScope = (typeof ADMIN_GROUP_BY_SCOPES)[number];

export const ALLOWED_INTENT_METRICS_MAP: Record<AdminChatIntent, readonly string[]> = {
  admin_student_lookup: [],
  admin_student_phone: [],
  admin_student_tuition: ['gross_billed', 'net_billed', 'discount_total', 'cash_in', 'outstanding'],
  admin_center_headcount: [...ADMIN_HEADCOUNT_STATES],
  admin_center_finance: [...ADMIN_FINANCE_METRICS],
  admin_class_tuition: ['gross_billed', 'net_billed', 'discount_total', 'cash_in', 'outstanding'],
  admin_class_tuition_ranking: [...ADMIN_RANKING_CRITERIA],
  admin_class_course_period: [],
  admin_teacher_payroll: ['session_count', 'accrued_salary'],
  admin_student_academic: ['midterm', 'final', 'assignments', 'attendance'],
  admin_zalo_operations: ['links', 'messages', 'errors', 'backlog'],
};

/**
 * Maps common Vietnamese terms / phrases asked by admins to standard canonical metrics.
 */
export const GLOSSARY_PHRASE_MAPPINGS: Record<string, AdminFinanceMetric> = {
  'doanh thu dự kiến': 'net_billed',
  'doanh thu dự kiến tháng': 'net_billed',
  'phải thu ròng': 'net_billed',
  'doanh thu gộp': 'gross_billed',
  'tổng học phí': 'gross_billed',
  'đã thu thực tế': 'cash_in',
  'tiền thực thu': 'cash_in',
  'thực thu': 'cash_in',
  'tiền vào': 'cash_in',
  'đã thu trên cohort': 'collected_cohort',
  'thu trên cohort': 'collected_cohort',
  'đã chi': 'cash_out',
  'tiền thực chi': 'cash_out',
  'thực chi': 'cash_out',
  'chi phí': 'cash_out',
  'dòng tiền ròng': 'net_cash_flow',
  'dòng tiền': 'net_cash_flow',
  'học bổng': 'discount',
  'giảm giá': 'discount',
  'miễn giảm': 'waiver',
  'hoàn cảnh': 'waiver',
  'công nợ': 'outstanding',
  'còn nợ': 'outstanding',
  'chưa thu': 'outstanding',
};

export function mapUserPhraseToFinanceMetric(phrase: string): AdminFinanceMetric | null {
  const normalized = String(phrase || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return GLOSSARY_PHRASE_MAPPINGS[normalized] ?? null;
}

/**
 * Checks if ratio qualifies as nearly paid: netDueTotal > 0 and 90% <= paidRatio < 100%.
 * Net due total = 0 never qualifies for nearly paid (it is 'no_receivable').
 */
export function isNearlyPaidRatio(
  paidTotal: number | null | undefined,
  netDueTotal: number | null | undefined
): boolean {
  if (paidTotal == null || netDueTotal == null) return false;
  if (netDueTotal <= 0) return false;
  const ratio = paidTotal / netDueTotal;
  return ratio >= NEARLY_PAID_THRESHOLD && ratio < 1.0;
}

/**
 * Calculates net cash flow (cash in - cash out). Returns null if either is null/undefined.
 */
export function calculateNetCashFlow(
  cashIn: number | null | undefined,
  cashOut: number | null | undefined
): number | null {
  if (cashIn == null || cashOut == null) return null;
  return finiteMoney(cashIn) - finiteMoney(cashOut);
}

/**
 * Derives the ranking band deterministically for a class term tuition summary.
 */
export function deriveClassTuitionRankingBand(summary: {
  netDueTotal: number | null;
  paidTotal: number | null;
  outstandingTotal: number | null;
  complete: boolean;
  missingLedgerCount?: number;
  warningRowCount?: number;
}): AdminRankingBand {
  if (
    !summary.complete ||
    (summary.missingLedgerCount ?? 0) > 0 ||
    (summary.warningRowCount ?? 0) > 0
  ) {
    return 'incomplete';
  }
  if (
    summary.netDueTotal == null ||
    summary.paidTotal == null ||
    summary.outstandingTotal == null
  ) {
    return 'incomplete';
  }

  const netDue = finiteMoney(summary.netDueTotal);
  const paid = finiteMoney(summary.paidTotal);
  const outstanding = finiteMoney(summary.outstandingTotal);

  if (netDue === 0) {
    return 'no_receivable';
  }

  if (outstanding === 0 && paid >= netDue) {
    return 'fully_paid';
  }

  if (isNearlyPaidRatio(paid, netDue)) {
    return 'nearly_paid';
  }

  return 'outstanding';
}

export type ResolvedPeriodBounds = {
  kind: 'day' | 'month' | 'custom_range';
  monthKey?: string; // YYYY-MM
  dateKey?: string; // YYYY-MM-DD
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive)
  displayLabel: string;
};

/**
 * Resolves period bounds deterministically in Vietnam timezone (Asia/Ho_Chi_Minh).
 */
export function resolvePeriodBounds(
  periodInput: string | undefined | null,
  referenceDate = new Date(),
  timeZone = VN_TIME_ZONE
): ResolvedPeriodBounds {
  const input = String(periodInput || '')
    .trim()
    .toLowerCase();
  const currentMonthKey = formatInTimeZone(referenceDate, timeZone, 'yyyy-MM');
  const currentDateKey = formatInTimeZone(referenceDate, timeZone, 'yyyy-MM-dd');

  const [currentYearStr, currentMonthStr] = currentMonthKey.split('-');
  const currentYear = Number(currentYearStr);
  const currentMonthNum = Number(currentMonthStr);

  if (!input || input === 'current_month' || input === 'tháng này') {
    const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonthNum, 0)).getUTCDate();
    const padMonth = String(currentMonthNum).padStart(2, '0');
    return {
      kind: 'month',
      monthKey: currentMonthKey,
      startDate: `${currentYear}-${padMonth}-01`,
      endDate: `${currentYear}-${padMonth}-${String(lastDayOfMonth).padStart(2, '0')}`,
      displayLabel: `Tháng ${padMonth}/${currentYear}`,
    };
  }

  if (input === 'previous_month' || input === 'tháng trước') {
    let prevYear = currentYear;
    let prevMonthNum = currentMonthNum - 1;
    if (prevMonthNum === 0) {
      prevMonthNum = 12;
      prevYear -= 1;
    }
    const padPrevMonth = String(prevMonthNum).padStart(2, '0');
    const prevMonthKey = `${prevYear}-${padPrevMonth}`;
    const lastDayOfPrevMonth = new Date(Date.UTC(prevYear, prevMonthNum, 0)).getUTCDate();
    return {
      kind: 'month',
      monthKey: prevMonthKey,
      startDate: `${prevYear}-${padPrevMonth}-01`,
      endDate: `${prevYear}-${padPrevMonth}-${String(lastDayOfPrevMonth).padStart(2, '0')}`,
      displayLabel: `Tháng ${padPrevMonth}/${prevYear}`,
    };
  }

  if (input === 'today' || input === 'hôm nay') {
    return {
      kind: 'day',
      dateKey: currentDateKey,
      startDate: currentDateKey,
      endDate: currentDateKey,
      displayLabel: `Hôm nay (${formatInTimeZone(referenceDate, timeZone, 'dd/MM/yyyy')})`,
    };
  }

  // Check explicit YYYY-MM
  const yyyyMmMatch = input.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (yyyyMmMatch) {
    const year = Number(yyyyMmMatch[1]);
    const monthNum = Number(yyyyMmMatch[2]);
    const padMonth = String(monthNum).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    return {
      kind: 'month',
      monthKey: `${year}-${padMonth}`,
      startDate: `${year}-${padMonth}-01`,
      endDate: `${year}-${padMonth}-${String(lastDay).padStart(2, '0')}`,
      displayLabel: `Tháng ${padMonth}/${year}`,
    };
  }

  // Check explicit MM/YYYY
  const mmYyyyMatch = input.match(/^(0?[1-9]|1[0-2])\/(\d{4})$/);
  if (mmYyyyMatch) {
    const monthNum = Number(mmYyyyMatch[1]);
    const year = Number(mmYyyyMatch[2]);
    const padMonth = String(monthNum).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    return {
      kind: 'month',
      monthKey: `${year}-${padMonth}`,
      startDate: `${year}-${padMonth}-01`,
      endDate: `${year}-${padMonth}-${String(lastDay).padStart(2, '0')}`,
      displayLabel: `Tháng ${padMonth}/${year}`,
    };
  }

  // Fallback to current month
  const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonthNum, 0)).getUTCDate();
  const padMonth = String(currentMonthNum).padStart(2, '0');
  return {
    kind: 'month',
    monthKey: currentMonthKey,
    startDate: `${currentYear}-${padMonth}-01`,
    endDate: `${currentYear}-${padMonth}-${String(lastDayOfMonth).padStart(2, '0')}`,
    displayLabel: `Tháng ${padMonth}/${currentYear}`,
  };
}

/**
 * Deduplicates, limits (1-3) and validates metrics array against intent allowlist.
 */
export function normalizeAdminMetrics<T extends string>(
  rawMetrics: unknown,
  allowedMetrics: readonly T[]
): T[] {
  if (!Array.isArray(rawMetrics)) return [];
  const set = new Set<T>();
  for (const item of rawMetrics) {
    if (typeof item === 'string' && (allowedMetrics as readonly string[]).includes(item as T)) {
      set.add(item as T);
      if (set.size >= MAX_METRICS_PER_QUESTION) break;
    }
  }
  return Array.from(set);
}
