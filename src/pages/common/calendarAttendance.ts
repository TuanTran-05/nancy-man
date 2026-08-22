export type CalendarAttendanceState = 'complete' | 'missing' | 'partial' | 'pending';

export function getCalendarAttendanceState({
  markedCount,
  activeStudentCount,
  isPastDate,
}: {
  markedCount: number;
  activeStudentCount: number;
  isPastDate: boolean;
}): CalendarAttendanceState {
  if (markedCount === 0) return isPastDate ? 'missing' : 'pending';
  if (markedCount < activeStudentCount) return 'partial';
  return 'complete';
}
