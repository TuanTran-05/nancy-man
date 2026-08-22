import { ALL, type ReportFilter } from './studentReportFilter';
import type { TermSessionValue } from '../api/studentAdminReportApi';

/**
 * Which course's estimate to show, or null for "show nothing".
 *
 * The figures are whole-course by construction (spec D1), so they are only
 * honest when the user is looking at exactly one whole course.
 */
export function selectTermSessionValue(
  byTerm: Record<string, TermSessionValue>,
  filter: Pick<ReportFilter, 'termKey' | 'from' | 'to'>
): TermSessionValue | null {
  // Courses can have different unit prices; a blended total is misleading.
  if (filter.termKey === ALL) return null;

  // A date range filters the ROWS (studentReportFilter.ts:121) but cannot filter
  // a whole-course figure. Showing "3 buổi có thể hoàn" beside a table listing
  // one of them is worse than showing nothing. Recounting from filtered rows was
  // rejected: the refund amount would move as the user scrubs dates, reading as
  // though the money itself had changed.
  if (filter.from || filter.to) return null;

  return byTerm[filter.termKey] ?? null;
}
