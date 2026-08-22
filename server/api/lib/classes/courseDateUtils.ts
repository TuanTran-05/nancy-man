export function getRequiredSessions(_grade: number | undefined): number {
  return 16;
}

export function calculateEndDate(
  startDate: string,
  requiredSessions: number,
  daysOfWeek: number[],
  holidays: string[]
): string {
  if (!startDate || requiredSessions <= 0 || !daysOfWeek?.length) return startDate;

  const holidaySet = new Set(holidays);
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const current = new Date(startYear, startMonth - 1, startDay);
  let sessionCount = 0;

  let safety = 0;
  while (sessionCount < requiredSessions && safety < 730) {
    safety++;
    const dayOfWeek = current.getDay();
    const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;

    if (daysOfWeek.includes(dayOfWeek) && !holidaySet.has(dateStr)) {
      sessionCount++;
      if (sessionCount === requiredSessions) {
        return dateStr;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
}
