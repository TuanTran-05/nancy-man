import {
  apiDateToDisplayDate,
  normalizeUserDateInput,
  normalizeUserDateTimeInput,
  normalizeUserTimeInput,
} from '../../../../shared/dateTimeFormat.js';

type CoursePeriodLike = {
  startDate?: unknown;
  endDate?: unknown;
  name?: unknown;
};

type CoursePeriodOptions = {
  fallbackToName?: boolean;
};

export function formatDateForZalo(dateInput: string | Date): string {
  if (dateInput instanceof Date) {
    if (Number.isNaN(dateInput.getTime())) return '';
    const day = String(dateInput.getDate()).padStart(2, '0');
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${dateInput.getFullYear()}`;
  }

  const raw = String(dateInput || '').trim();
  if (!raw) return '';

  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return apiDateToDisplayDate(raw);
    if (/^\d{1,2}:\d{1,2}(?::\d{1,2})?$/.test(raw)) return normalizeUserTimeInput(raw);
    if (/^\d{1,2}:\d{1,2}(?::\d{1,2})?\s+\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
      return normalizeUserDateTimeInput(raw);
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return normalizeUserDateInput(raw);
  } catch {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return formatDateForZalo(parsed);
}

export function formatCoursePeriodForZalo(
  classData: CoursePeriodLike,
  options: CoursePeriodOptions = {}
): string {
  const startDate = String(classData.startDate || '');
  const endDate = String(classData.endDate || '');

  if (startDate && endDate)
    return `${formatDateForZalo(startDate)} - ${formatDateForZalo(endDate)}`;
  if (startDate) return formatDateForZalo(startDate);
  if (endDate) return formatDateForZalo(endDate);
  return options.fallbackToName ? String(classData.name || '') : '';
}
