import { formatDateForZalo } from '../../lib/zalo/zaloFormat.js';
import { getClassGrade } from '../../lib/auth/authz.js';
import { calculateEndDate, getRequiredSessions } from '../../lib/classes/courseDateUtils.js';
import { TUITION_DUE_DAYS_AFTER_TERM_START } from '../../../../shared/tuitionDueDate.js';

/**
 * Re-exported so the notice sent to parents and the `dueDate` stamped on the
 * ledger can never quote two different deadlines.
 */
export const NEXT_COURSE_TUITION_DUE_DAYS = TUITION_DUE_DAYS_AFTER_TERM_START;

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toDateOnlyString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export function getClassDaysOfWeek(classData: Record<string, unknown>): number[] {
  if (!Array.isArray(classData.daysOfWeek)) return [];
  return classData.daysOfWeek
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

export function getNextClassSessionDate(
  previousEndDate: Date,
  daysOfWeek: number[],
  holidays: string[]
): Date {
  if (!daysOfWeek.length) return addDays(previousEndDate, 7);

  const holidaySet = new Set(holidays);
  const next = addDays(previousEndDate, 1);
  let safety = 0;
  while (safety < 730) {
    const dateStr = toDateOnlyString(next);
    if (daysOfWeek.includes(next.getDay()) && !holidaySet.has(dateStr)) {
      return new Date(next);
    }
    next.setDate(next.getDate() + 1);
    safety++;
  }

  return addDays(previousEndDate, 7);
}

export function getVietnamNoticeDate(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
}

export function getCourseEndDateForTuition(
  courseEndDate: string,
  classData: Record<string, unknown>
): string {
  const rawDate = courseEndDate || String(classData.endDate || '');
  return rawDate ? formatDateForZalo(rawDate) : formatDateForZalo(new Date());
}

export function getString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  return typeof val === 'string' ? val : '';
}

export function getTuitionDueDate(
  body: Record<string, unknown>,
  _courseEndDate: string,
  _classData: Record<string, unknown>
): string {
  const explicitDueDate = getString(body, 'tuitionDueDate') || getString(body, 'paymentDueDate');
  if (explicitDueDate) return formatDateForZalo(explicitDueDate);

  return formatDateForZalo(addDays(getVietnamNoticeDate(), NEXT_COURSE_TUITION_DUE_DAYS));
}

export function parseDateOnly(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = String(value || '').trim();
  if (!raw || /^\d{1,2}:\d{2}:\d{2}$/.test(raw)) return null;

  const timeAndDateMatch = raw.match(/^\d{1,2}:\d{2}:\d{2}\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (timeAndDateMatch) {
    const [, day, month, year] = timeAndDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const vnDateMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (vnDateMatch) {
    const [, day, month, year] = vnDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const isoDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function getNextCourseTuitionSchedule(
  courseEndDate: string,
  classData: Record<string, unknown>
) {
  const previousEndDate =
    parseDateOnly(courseEndDate) || parseDateOnly(classData.endDate) || getVietnamNoticeDate();
  const grade = getClassGrade(classData);
  const requiredSessions = getRequiredSessions(grade);
  const classHolidays = Array.isArray(classData.holidays) ? (classData.holidays as string[]) : [];
  const daysOfWeek = getClassDaysOfWeek(classData);
  const startDate = getNextClassSessionDate(previousEndDate, daysOfWeek, classHolidays);
  const startDateStr = toDateOnlyString(startDate);
  const endDateStr = calculateEndDate(startDateStr, requiredSessions, daysOfWeek, classHolidays);
  const dueDate = addDays(startDate, NEXT_COURSE_TUITION_DUE_DAYS);

  return {
    previousEndDate: formatDateForZalo(previousEndDate),
    startDate: formatDateForZalo(startDate),
    endDate: formatDateForZalo(endDateStr),
    dueDate: formatDateForZalo(dueDate),
  };
}
