import { formatInTimeZone } from 'date-fns-tz';

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type StaffTenure = {
  years: number;
  months: number;
  days: number;
};

function toVietnamCalendarDate(value: string | Date | undefined): CalendarDate | null {
  if (!value) return null;

  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;

  try {
    const [year, month, day] = formatInTimeZone(instant, VN_TIMEZONE, 'yyyy-MM-dd')
      .split('-')
      .map(Number);
    if (!year || !month || !day) return null;
    return { year, month, day };
  } catch {
    return null;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(year: number, month: number, day: number): CalendarDate {
  return {
    year,
    month,
    day: Math.min(day, daysInMonth(year, month)),
  };
}

function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const monthIndex = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return clampDay(year, month, date.day);
}

function calendarDayNumber(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY;
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return calendarDayNumber(left) - calendarDayNumber(right);
}

export function calculateStaffTenure(
  createdAt: string | undefined,
  asOf: Date
): StaffTenure | null {
  const start = toVietnamCalendarDate(createdAt);
  const end = toVietnamCalendarDate(asOf);
  if (!start || !end || compareCalendarDates(start, end) > 0) return null;

  let totalMonths = (end.year - start.year) * 12 + (end.month - start.month);
  let cursor = addCalendarMonths(start, totalMonths);
  if (compareCalendarDates(cursor, end) > 0) {
    totalMonths -= 1;
    cursor = addCalendarMonths(start, totalMonths);
  }

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const days = calendarDayNumber(end) - calendarDayNumber(cursor);
  return { years, months, days };
}
