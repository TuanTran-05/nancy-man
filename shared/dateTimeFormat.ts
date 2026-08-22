import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export const API_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const API_TIME_ONLY_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

type DateParts = { year: number; month: number; day: number };
type TimeParts = { hour: number; minute: number; second: number };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function assertDateParts({ year, month, day }: DateParts): void {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Invalid date');
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('Invalid date');
  }
}

function assertTimeParts({ hour, minute, second }: TimeParts): void {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new Error('Invalid time');
  }
}

function parseUserDateParts(value: unknown): DateParts {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error('Invalid date');

  const parts = {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
  };
  assertDateParts(parts);
  return parts;
}

function parseApiDateParts(value: unknown): DateParts {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Invalid date');

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  assertDateParts(parts);
  return parts;
}

function parseUserTimeParts(value: unknown): TimeParts {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) throw new Error('Invalid time');

  const parts = {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: match[3] === undefined ? 0 : Number(match[3]),
  };
  assertTimeParts(parts);
  return parts;
}

function parseApiTimeParts(value: unknown): TimeParts {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Invalid time');

  const parts = {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3]),
  };
  assertTimeParts(parts);
  return parts;
}

export function normalizeUserDateInput(value: unknown): string {
  const { day, month, year } = parseUserDateParts(value);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

export function normalizeUserTimeInput(value: unknown): string {
  const { hour, minute, second } = parseUserTimeParts(value);
  return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

export function normalizeUserDateTimeInput(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  const match = raw.match(/^(\d{1,2}:\d{1,2}(?::\d{1,2})?)\s+(\d{1,2}\/\d{1,2}\/\d{4})$/);
  if (!match) throw new Error('Invalid datetime');

  const time = normalizeUserTimeInput(match[1]);
  const date = normalizeUserDateInput(match[2]);
  return `${time} ${date}`;
}

export function userDateToApiDate(value: unknown): string {
  const { day, month, year } = parseUserDateParts(value);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function apiDateToDisplayDate(value: unknown): string {
  const { year, month, day } = parseApiDateParts(value);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

export function normalizeDateLikeToApiDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (API_DATE_ONLY_PATTERN.test(raw)) {
    parseApiDateParts(raw);
    return raw;
  }
  return userDateToApiDate(raw);
}

export function dateToApiDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dateToApiDateInTimeZone(date: Date, timeZone = VN_TIME_ZONE): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
}

export function dateToApiMonthInTimeZone(date: Date, timeZone = VN_TIME_ZONE): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return formatInTimeZone(date, timeZone, 'yyyy-MM');
}

export function apiTimeToDisplayTime(value: unknown): string {
  const { hour, minute, second } = parseApiTimeParts(value);
  return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

export function userDateTimeToApiIso(value: unknown, timeZone = VN_TIME_ZONE): string {
  const normalized = normalizeUserDateTimeInput(value);
  const [time, date] = normalized.split(' ');
  const [day, month, year] = date.split('/').map(Number);
  const zonedInput = `${year}-${pad2(month)}-${pad2(day)}T${time}`;
  return fromZonedTime(zonedInput, timeZone).toISOString();
}

export function apiDateTimeToDisplayDateTime(
  value: unknown,
  timeZone = VN_TIME_ZONE,
  formatStr = 'dd/MM/yyyy HH:mm'
): string {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) throw new Error('Invalid datetime');
  return formatInTimeZone(date, timeZone, formatStr);
}

export function isApiMonth(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(raw);
}

export function isApiDateOnly(value: unknown): boolean {
  try {
    parseApiDateParts(value);
    return true;
  } catch {
    return false;
  }
}

export function isApiTimeOnly(value: unknown): boolean {
  try {
    parseApiTimeParts(value);
    return true;
  } catch {
    return false;
  }
}

export function isApiDateTime(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const date = new Date(raw);
  return !Number.isNaN(date.getTime()) && raw.includes('T');
}
