import { formatInTimeZone } from 'date-fns-tz';
import { apiDateToDisplayDate } from '../../../shared/dateTimeFormat';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatStudentDate(value: string | undefined): string {
  if (!value) return '';

  if (CANONICAL_DATE_PATTERN.test(value)) {
    try {
      return apiDateToDisplayDate(value);
    } catch {
      return value;
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatInTimeZone(parsed, VIETNAM_TIMEZONE, 'dd/MM/yyyy');
}
