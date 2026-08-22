import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { dateToApiMonthInTimeZone, isApiMonth } from '../../../../shared/dateTimeFormat.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import {
  MAX_REPORT_DOCS_PER_COLLECTION,
  ReportRangeTooLargeError,
} from '../../lib/repositories/financeRepository.js';
import { buildCenterFinanceReport } from '../../lib/services/centerFinanceReportService.js';

export async function handleCenterReport(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
  if (!user) return;

  const db = getDb();
  const month = (req.query.month as string) || dateToApiMonthInTimeZone(new Date());
  if (!isApiMonth(month)) {
    return res.status(400).json({
      success: false,
      errorCode: 'invalid_month',
      error: 'Month must be a valid calendar month in YYYY-MM format.',
    });
  }

  const monthsRaw = Number.parseInt((req.query.months as string) || '12', 10);
  const months = Number.isFinite(monthsRaw) ? Math.min(24, Math.max(1, monthsRaw)) : 12;

  try {
    return res.json(await buildCenterFinanceReport(db, { month, months }));
  } catch (err) {
    if (err instanceof ReportRangeTooLargeError) {
      return res.status(413).json({
        success: false,
        errorCode: 'report_too_large',
        error: 'Report range is too large. Please narrow the date range.',
        limit: MAX_REPORT_DOCS_PER_COLLECTION,
      });
    }
    throw err;
  }
}
