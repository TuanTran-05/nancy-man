import type { Class, Attendance } from '../../types';

export function getEffectiveClassDates(
  classData: Class | null,
  coursePeriod: { start?: string | null; end?: string | null },
  holidays: string[] | null | undefined,
  attendanceData: Attendance[] | null | undefined,
  classSessions: { date: string }[] | null | undefined
): Date[] {
  if (!classData || !classData.daysOfWeek) return [];

  const startStr = coursePeriod.start || classData.startDate;
  const endStr = coursePeriod.end || classData.endDate;
  if (!startStr || !endStr) return [];

  const start = new Date(startStr);
  const plannedEnd = new Date(endStr);

  let plannedSessionCount = 0;
  const currCount = new Date(start);
  while (currCount <= plannedEnd) {
    if (classData.daysOfWeek.includes(currCount.getDay())) {
      plannedSessionCount++;
    }
    currCount.setDate(currCount.getDate() + 1);
  }

  const dates: Date[] = [];
  const curr = new Date(start);
  let emergencyStop = 0;

  while (
    dates.filter((d) => classData.daysOfWeek.includes(d.getDay())).length < plannedSessionCount
  ) {
    emergencyStop++;
    if (emergencyStop > 1000) break;

    const dateStrIso = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;
    const isHoliday = holidays?.includes(dateStrIso);

    if (classData.daysOfWeek.includes(curr.getDay())) {
      if (!isHoliday) {
        dates.push(new Date(curr));
      }
    }
    curr.setDate(curr.getDate() + 1);
  }

  const extraDateStrs = new Set<string>();
  attendanceData?.forEach((a) => extraDateStrs.add(a.date));
  classSessions?.forEach((s) => extraDateStrs.add(s.date));

  extraDateStrs.forEach((dateStrVN) => {
    const parts = dateStrVN.split('-');
    if (parts.length === 3) {
      const [d, m, y] = parts;
      const extraDate = new Date(Number(y), Number(m) - 1, Number(d));
      const isoString = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

      // Skip if it's a holiday, even if there is existing data
      if (holidays?.includes(isoString)) {
        return;
      }

      if (!dates.some((existing) => existing.getTime() === extraDate.getTime())) {
        dates.push(extraDate);
      }
    }
  });

  dates.sort((a, b) => a.getTime() - b.getTime());
  return dates;
}
