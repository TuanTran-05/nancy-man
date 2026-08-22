import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatInTimeZone } from 'date-fns-tz';
import { vi } from 'date-fns/locale';
import {
  apiDateTimeToDisplayDateTime,
  apiDateToDisplayDate,
  apiTimeToDisplayTime,
  dateToApiDate,
  normalizeDateLikeToApiDate,
  normalizeUserDateInput,
  normalizeUserDateTimeInput,
  normalizeUserTimeInput,
  userDateTimeToApiIso,
  userDateToApiDate,
} from '../../../shared/dateTimeFormat';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export {
  apiDateTimeToDisplayDateTime,
  apiDateToDisplayDate,
  apiTimeToDisplayTime,
  normalizeDateLikeToApiDate,
  normalizeUserDateInput,
  normalizeUserDateTimeInput,
  normalizeUserTimeInput,
  userDateTimeToApiIso,
  userDateToApiDate,
};

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

export function toDate(value: unknown): Date | null {
  if (!value) return null;

  try {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === 'object') {
      const maybeTimestamp = value as {
        toDate?: () => Date;
        toMillis?: () => number;
        seconds?: number;
        nanoseconds?: number;
        _seconds?: number;
        _nanoseconds?: number;
      };

      if (typeof maybeTimestamp.toDate === 'function') {
        const date = maybeTimestamp.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      }

      if (typeof maybeTimestamp.toMillis === 'function') {
        const date = new Date(maybeTimestamp.toMillis());
        return Number.isNaN(date.getTime()) ? null : date;
      }

      const seconds = maybeTimestamp.seconds ?? maybeTimestamp._seconds;
      const nanoseconds = maybeTimestamp.nanoseconds ?? maybeTimestamp._nanoseconds ?? 0;
      if (typeof seconds === 'number') {
        const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
        return Number.isNaN(date.getTime()) ? null : date;
      }
    }
  } catch (e) {
    console.error('Error converting value to Date:', value, e);
  }

  return null;
}

export function toTime(value: unknown, fallback = 0) {
  return toDate(value)?.getTime() ?? fallback;
}

export function formatVN(date: unknown, formatStr: string) {
  if (!date) return '';

  try {
    const dateObj = toDate(date);
    if (!dateObj) return '';

    return formatInTimeZone(dateObj, VN_TIMEZONE, formatStr, { locale: vi });
  } catch (e) {
    console.error('Error in formatVN:', date, e);
    return '';
  }
}

export function getVNDate() {
  // Returns a Date object that represents the current time in VN
  const vnTimeStr = new Date().toLocaleString('en-US', { timeZone: VN_TIMEZONE });
  return new Date(vnTimeStr);
}

export function getVNTodayStr() {
  return toVNDateStr(getVNDate());
}

export function toVNDateStr(date: Date) {
  return dateToApiDate(date);
}

export function getDayFromStr(dateStr: string) {
  if (!dateStr) return -1;
  try {
    const iso = normalizeDateLikeToApiDate(dateStr);
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  } catch {
    return -1;
  }
}
