import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { withStatus } from '../../lib/http/helpers.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type AuditLogFilters = {
  action: string;
  collectionName: string;
  startIso: string;
  endIso: string;
};

export function resolveAuditLogFilters(
  req: Pick<ApiRequest, 'query'>,
  now = new Date()
): AuditLogFilters {
  const action = typeof req.query.actionFilter === 'string' ? req.query.actionFilter.trim() : '';
  const collectionName =
    typeof req.query.collectionFilter === 'string' ? req.query.collectionFilter.trim() : '';
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';

  if (startDate && !ISO_DATE.test(startDate)) {
    throw withStatus('Invalid startDate format (expected YYYY-MM-DD)', 400);
  }
  if (endDate && !ISO_DATE.test(endDate)) {
    throw withStatus('Invalid endDate format (expected YYYY-MM-DD)', 400);
  }

  let resolvedStartDate = startDate;
  let resolvedEndDate = endDate;

  if (!resolvedStartDate && !resolvedEndDate) {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    resolvedStartDate = start.toISOString().split('T')[0];
    resolvedEndDate = end.toISOString().split('T')[0];
  } else if (resolvedStartDate && !resolvedEndDate) {
    const start = new Date(resolvedStartDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    resolvedEndDate = end.toISOString().split('T')[0];
  } else if (!resolvedStartDate && resolvedEndDate) {
    const end = new Date(resolvedEndDate);
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    resolvedStartDate = start.toISOString().split('T')[0];
  }

  const daysDiff =
    (new Date(resolvedEndDate).getTime() - new Date(resolvedStartDate).getTime()) / DAY_MS;
  if (daysDiff > 90) throw withStatus('Date range too large (max 90 days)', 400);
  if (daysDiff < 0) throw withStatus('startDate must be before or equal to endDate', 400);

  return {
    action,
    collectionName,
    startIso: new Date(resolvedStartDate).toISOString(),
    endIso: new Date(`${resolvedEndDate}T23:59:59.999Z`).toISOString(),
  };
}
