/**
 * Pure domain helpers shared by API handlers and the browser. Keeping this
 * module free of DocumentStore dependencies ensures both sides use one definition
 * of a course term and one closed-course decision.
 */

export type ClosedCourseReason = 'term_ended' | 'closing_completed';

export type ClassTermRange = {
  termStart: string;
  termEnd: string | null;
};

export type ClassJoinWindow = ClassTermRange & {
  isClosed: boolean;
  closedReason: ClosedCourseReason | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateText(value: unknown): string {
  return typeof value === 'string' && isIsoDate(value) ? value : '';
}

export function resolveClassTermRange(
  classData: Record<string, unknown>,
  today: string
): ClassTermRange | null {
  const terms = Array.isArray(classData.terms) ? classData.terms : [];
  const matching = terms
    .filter((term): term is Record<string, unknown> => !!term && typeof term === 'object')
    .map((term) => ({ start: dateText(term.startDate), end: dateText(term.endDate) || null }))
    .filter(({ start, end }) => start && start <= today && (!end || today <= end))
    .sort((a, b) => b.start.localeCompare(a.start))[0];

  if (matching) return { termStart: matching.start, termEnd: matching.end };

  const start = dateText(classData.startDate);
  if (!start) return null;
  return { termStart: start, termEnd: dateText(classData.endDate) || null };
}

export function courseClosingApproved(classData: Record<string, unknown>): boolean {
  if (classData.courseClosingApproved === true) return true;
  const closing = classData.courseClosing;
  if (!closing || typeof closing !== 'object') return false;
  const approval = (closing as { approval?: unknown }).approval;
  return (
    !!approval &&
    typeof approval === 'object' &&
    (approval as { status?: unknown }).status === 'approved'
  );
}

export function resolveClassJoinWindow(
  classData: Record<string, unknown>,
  today: string
): ClassJoinWindow | null {
  const range = resolveClassTermRange(classData, today);
  if (!range) return null;

  const closedReason: ClosedCourseReason | null =
    range.termEnd !== null && today > range.termEnd
      ? 'term_ended'
      : courseClosingApproved(classData)
        ? 'closing_completed'
        : null;

  return { ...range, isClosed: closedReason !== null, closedReason };
}

export function isJoinedAtInWindow(range: ClassTermRange, joinedAt: string): boolean {
  if (!isIsoDate(joinedAt) || !isIsoDate(range.termStart)) return false;
  if (range.termEnd !== null && !isIsoDate(range.termEnd)) return false;
  if (joinedAt < range.termStart) return false;
  return range.termEnd === null || joinedAt <= range.termEnd;
}

export function resolveTermJoinedAt(range: ClassTermRange, today: string): string {
  if (today < range.termStart) return range.termStart;
  if (range.termEnd && today > range.termEnd) return range.termEnd;
  return today;
}
