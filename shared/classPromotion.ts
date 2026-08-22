/**
 * When a cohort is promoted, a new class is created from the old one and the students
 * move across. From that moment the source class stops running, so its sessions must no
 * longer be scheduled, marked, or paid — payroll follows the new class.
 *
 * The link lives on the new class as `importSourceClassId` + `promotedAt`.
 */

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const date =
    typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Maps a source class id to the date its cohort was promoted away.
 * When a class was used as the source more than once, the earliest promotion wins:
 * that is when it actually stopped being the cohort's class.
 */
export function buildPromotionCutoffByClassId(
  classes: ReadonlyArray<{ importSourceClassId?: unknown; promotedAt?: unknown }>
): Map<string, string> {
  const cutoffs = new Map<string, string>();
  for (const cls of classes) {
    const sourceClassId = String(cls.importSourceClassId || '').trim();
    if (!sourceClassId) continue;
    const promotedOn = toIsoDate(cls.promotedAt);
    if (!promotedOn) continue;
    const existing = cutoffs.get(sourceClassId);
    if (!existing || promotedOn < existing) cutoffs.set(sourceClassId, promotedOn);
  }
  return cutoffs;
}

/** True once a source class has handed its cohort over on or before `date`. */
export function isAfterPromotionCutoff(
  cutoffs: ReadonlyMap<string, string>,
  classId: string,
  date: string
): boolean {
  const cutoff = cutoffs.get(classId);
  return Boolean(cutoff && date >= cutoff);
}

/**
 * The last date a promoted class may still schedule sessions, or the untouched
 * `endDate` when it was never a promotion source.
 */
export function clampEndDateToPromotion(
  cutoffs: ReadonlyMap<string, string>,
  classId: string,
  endDate: string
): string {
  const cutoff = cutoffs.get(classId);
  if (!cutoff) return endDate;
  const lastDay = new Date(`${cutoff}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const clamped = lastDay.toISOString().slice(0, 10);
  return !endDate || endDate > clamped ? clamped : endDate;
}
