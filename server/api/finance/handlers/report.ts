import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { isApiDateOnly } from '../../../../shared/dateTimeFormat.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import {
  MAX_REPORT_DOCS_PER_COLLECTION,
  ReportRangeTooLargeError,
} from '../../lib/repositories/financeRepository.js';
import { buildFinanceReport } from '../../lib/services/financeReportService.js';

export async function handleReport(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
  if (!user) return;

  const db = getDb();
  const startDate = (req.query.startDate as string) || '';
  const endDate = (req.query.endDate as string) || '';
  const forceLive = req.query.forceLive === '1';
  const includeDaily = req.query.includeDaily === '1';

  if (
    includeDaily &&
    (!isApiDateOnly(startDate) || !isApiDateOnly(endDate) || startDate > endDate)
  ) {
    return res.status(400).json({
      success: false,
      errorCode: 'invalid_date_range',
      error: 'Daily reports require a valid startDate and endDate.',
    });
  }

  try {
    return res.json(
      await buildFinanceReport(db, { startDate, endDate, forceLive, includeDaily })
    );
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
