/**
 * Tuition falls due two weeks after a course starts — the same promise the
 * course-closing notice makes to parents ("Học phí cần thanh toán trước ngày …"),
 * so the ledger and the notice cannot drift apart.
 */
export const TUITION_DUE_DAYS_AFTER_TERM_START = 14;

/** `termStart` is a YYYY-MM-DD date; returns '' for anything else. */
export function courseTuitionDueDate(
  termStart: unknown,
  dueDays: number = TUITION_DUE_DAYS_AFTER_TERM_START
): string {
  if (typeof termStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(termStart)) return '';
  const parsed = new Date(`${termStart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + dueDays);
  return parsed.toISOString().slice(0, 10);
}
