import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  calculateNetCashFlow,
  resolvePeriodBounds,
  type AdminFinanceMetric,
} from '../../../../../shared/adminChatMetrics.js';
import { buildCenterFinanceReport } from '../../../lib/services/centerFinanceReportService.js';
import type {
  AdminCenterFinanceResult,
  AdminDataQuality,
  AdminDataQualityIssue,
} from './adminChatTypes.js';

/**
 * Queries center finance report for a specific period (e.g. current_month, previous_month, YYYY-MM)
 * directly calling the in-process centerFinanceReportService.
 */
export async function queryAdminCenterFinance(
  db: DocumentStore,
  options: {
    period?: string | null;
    requestedMetrics?: AdminFinanceMetric[];
  },
  now = new Date()
): Promise<AdminCenterFinanceResult> {
  const computedAt = now.toISOString();
  const period = resolvePeriodBounds(options.period, now);
  const monthKey = period.monthKey ?? now.toISOString().slice(0, 7);

  const requestedMetrics =
    options.requestedMetrics && options.requestedMetrics.length > 0
      ? options.requestedMetrics
      : (['net_billed', 'cash_in', 'cash_out'] as AdminFinanceMetric[]);

  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';

  try {
    const report = await buildCenterFinanceReport(db, {
      month: monthKey,
      months: 1,
    });

    const current = report.current;
    const discountBreakdown = report.discountBreakdown;
    const netCashFlow = calculateNetCashFlow(current.cashIn, current.cashOut);

    return {
      kind: 'center_finance',
      period,
      requestedMetrics,
      grossBilled: current.grossBilled,
      netBilled: current.netBilled,
      collectedCohort: current.collectedCohort,
      cashIn: current.cashIn,
      cashOut: current.cashOut,
      netCashFlow,
      discount: discountBreakdown.discount,
      waiver: discountBreakdown.waiver,
      unclassifiedReduction: discountBreakdown.unclassified,
      discountTotal: current.discountTotal,
      outstanding: current.outstanding,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'center_finance_report_service_v1',
    };
  } catch (err: unknown) {
    qualityStatus = 'failed';
    issues.push({
      code: 'source_incomplete',
      source: 'center_finance_report_service_v1',
    });

    return {
      kind: 'center_finance',
      period,
      requestedMetrics,
      grossBilled: null,
      netBilled: null,
      collectedCohort: null,
      cashIn: null,
      cashOut: null,
      netCashFlow: null,
      discount: null,
      waiver: null,
      unclassifiedReduction: null,
      discountTotal: null,
      outstanding: null,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'center_finance_report_service_v1',
    };
  }
}
