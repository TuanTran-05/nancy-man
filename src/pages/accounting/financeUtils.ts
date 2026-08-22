import { apiDateToDisplayDate, apiDateTimeToDisplayDateTime } from '../../lib/core/utils';
import { formatVndAmount } from '../../lib/core/moneyFormat';

export function toTime(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'string') {
    const time = new Date(v).getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : 0;
  if (typeof v !== 'object') return 0;

  const dateLike = v as {
    toDate?: () => Date;
    toMillis?: () => number;
    seconds?: number;
    nanoseconds?: number;
    _seconds?: number;
    _nanoseconds?: number;
  };
  if (typeof dateLike.toDate === 'function') return toTime(dateLike.toDate());
  if (typeof dateLike.toMillis === 'function') {
    const time = dateLike.toMillis();
    return Number.isFinite(time) ? time : 0;
  }
  const seconds = dateLike.seconds ?? dateLike._seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    const nanos = dateLike.nanoseconds ?? dateLike._nanoseconds ?? 0;
    return seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  return 0;
}

export const fmt = (n: number) => formatVndAmount(n);

export const formatDate = (value: unknown, _language: string) => {
  if (!value) return '-';

  if (typeof value === 'string') {
    const raw = value.trim();
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return apiDateToDisplayDate(raw);
      return apiDateTimeToDisplayDateTime(raw, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
    } catch {
      const time = Date.parse(raw);
      return time
        ? apiDateTimeToDisplayDateTime(
            new Date(time).toISOString(),
            'Asia/Ho_Chi_Minh',
            'dd/MM/yyyy'
          )
        : '-';
    }
  }

  const time = toTime(value);
  return time
    ? apiDateTimeToDisplayDateTime(new Date(time).toISOString(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy')
    : '-';
};
