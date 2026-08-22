const TRIAL_TIMESTAMP_TOLERANCE_MS = 10 * 60 * 1000;

function parseTime(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  const seconds =
    value && typeof value === 'object'
      ? Number(
          (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
            (value as { _seconds?: unknown })._seconds
        )
      : Number.NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function isNear(left: number | null, right: number | null): boolean {
  return left !== null && right !== null && Math.abs(left - right) <= TRIAL_TIMESTAMP_TOLERANCE_MS;
}

export function shouldInitializeEnrollmentDate(record: Record<string, unknown>): boolean {
  if (record.enrollmentDate === undefined || record.enrollmentDate === null) return true;
  if (record.archiveReason === 'trial_rejected') return true;

  const enrollmentDate = parseTime(record.enrollmentDate);
  const trialStartedAt = parseTime(record.trialStartedAt ?? record.admittedAt);
  if (!isNear(enrollmentDate, trialStartedAt)) return false;

  const createdAt = parseTime(record.createdAt);
  return createdAt === null || isNear(enrollmentDate, createdAt);
}
