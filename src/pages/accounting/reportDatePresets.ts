export type ReportDateRange = { from: string; to: string };

export type ReportDatePresetKey =
  | 'today'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'lastYear';

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCalendarMonthRange(year: number, zeroBasedMonth: number): ReportDateRange {
  return {
    from: formatLocalDate(new Date(year, zeroBasedMonth, 1)),
    to: formatLocalDate(new Date(year, zeroBasedMonth + 1, 0)),
  };
}

export function getReportDatePresets(now: Date = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = formatLocalDate(now);
  const quarterStartMonth = Math.floor(month / 3) * 3;

  return {
    today: { from: today, to: today },
    thisMonth: getCalendarMonthRange(year, month),
    lastMonth: getCalendarMonthRange(year, month - 1),
    thisQuarter: {
      from: formatLocalDate(new Date(year, quarterStartMonth, 1)),
      to: today,
    },
    thisYear: { from: `${year}-01-01`, to: today },
    lastYear: { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  } satisfies Record<ReportDatePresetKey, ReportDateRange>;
}
