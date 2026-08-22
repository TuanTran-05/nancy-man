const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export function normalizeDateOnly(value?: string | null): string {
  const text = String(value || '').trim();
  const match = DATE_ONLY_PATTERN.exec(text);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return '';
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function dateOnlyTimestamp(value?: string | null): number | null {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function daysBetweenDateOnly(from: string, to: string): number | null {
  const fromTime = dateOnlyTimestamp(from);
  const toTime = dateOnlyTimestamp(to);
  if (fromTime === null || toTime === null) return null;
  return Math.floor((toTime - fromTime) / 86_400_000);
}

export function formatDateOnlyShort(value?: string | null, fallback = '-'): string {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return fallback;
  const [, month, day] = normalized.split('-');
  return `${day}/${month}`;
}

export function formatDateOnlyDisplay(value?: string | null, fallback = '-'): string {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return fallback;
  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
}

export function toVietnamDateOnly(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
