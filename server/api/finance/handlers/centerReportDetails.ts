import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import {
  dateToApiMonthInTimeZone,
  isApiDateOnly,
  isApiMonth,
} from '../../../../shared/dateTimeFormat.js';
import type {
  FinanceDetailType,
  FinanceDetailsScope,
} from '../../../../shared/centerFinanceReportDetails.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import {
  buildCenterFinanceReportDetails,
  decodeCenterReportDetailsCursor,
} from '../../lib/services/centerFinanceReportDetailsService.js';

class ScopeResolutionError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
  }
}

function clampPageSize(value: unknown): number {
  const parsed = Number.parseInt(String(value || '25'), 10);
  const pageSize = Number.isFinite(parsed) ? parsed : 25;
  return Math.min(100, Math.max(1, pageSize));
}

function resolveReportScope(query: Record<string, unknown>): {
  scope: FinanceDetailsScope;
  month?: string;
} {
  const monthParam = typeof query.month === 'string' ? query.month.trim() : '';
  const startDateParam = typeof query.startDate === 'string' ? query.startDate.trim() : '';
  const endDateParam = typeof query.endDate === 'string' ? query.endDate.trim() : '';

  if (monthParam && (startDateParam || endDateParam)) {
    throw new ScopeResolutionError(
      'invalid_report_scope',
      'Cannot specify both month and explicit date range.'
    );
  }

  if (startDateParam || endDateParam) {
    if (
      !startDateParam ||
      !endDateParam ||
      !isApiDateOnly(startDateParam) ||
      !isApiDateOnly(endDateParam)
    ) {
      throw new ScopeResolutionError(
        'invalid_date_range',
        'startDate and endDate must both be valid dates in YYYY-MM-DD format.'
      );
    }
    if (startDateParam > endDateParam) {
      throw new ScopeResolutionError(
        'invalid_date_range',
        'startDate cannot be later than endDate.'
      );
    }
    return {
      scope: { startDate: startDateParam, endDate: endDateParam },
    };
  }

  const month = monthParam || dateToApiMonthInTimeZone(new Date());
  if (!isApiMonth(month)) {
    throw new ScopeResolutionError(
      'invalid_month',
      'Month must be a valid calendar month in YYYY-MM format.'
    );
  }
  return { scope: { month }, month };
}

export async function handleCenterReportDetails(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
  if (!user) return;

  let resolvedScope: { scope: FinanceDetailsScope; month?: string };
  try {
    resolvedScope = resolveReportScope(req.query as Record<string, unknown>);
  } catch (err) {
    if (err instanceof ScopeResolutionError) {
      return res.status(400).json({
        success: false,
        errorCode: err.errorCode,
        error: err.message,
      });
    }
    throw err;
  }

  const type = req.query.type as FinanceDetailType;
  if (type !== 'income' && type !== 'expense') {
    return res.status(400).json({
      success: false,
      errorCode: 'invalid_detail_type',
      error: 'Detail type must be income or expense.',
    });
  }

  let cursor = null;
  const cursorValue = typeof req.query.cursor === 'string' ? req.query.cursor : '';
  if (cursorValue) {
    try {
      cursor = decodeCenterReportDetailsCursor(cursorValue, resolvedScope.scope, type);
    } catch {
      return res.status(400).json({
        success: false,
        errorCode: 'invalid_cursor',
        error: 'Cursor is invalid for the selected scope and type.',
      });
    }
  }

  return res.json(
    await buildCenterFinanceReportDetails(getDb(), {
      ...resolvedScope.scope,
      type,
      pageSize: clampPageSize(req.query.pageSize),
      cursor,
    })
  );
}
