import { describe, expect, it } from 'vitest';
import { getCalendarAttendanceState } from './calendarAttendance';

describe('getCalendarAttendanceState', () => {
  it.each([
    [{ markedCount: 0, activeStudentCount: 20, isPastDate: true }, 'missing'],
    [{ markedCount: 0, activeStudentCount: 20, isPastDate: false }, 'pending'],
    [{ markedCount: 19, activeStudentCount: 20, isPastDate: true }, 'partial'],
    [{ markedCount: 20, activeStudentCount: 20, isPastDate: true }, 'complete'],
  ] as const)('maps compact attendance counts to %s', (input, expected) => {
    expect(getCalendarAttendanceState(input)).toBe(expected);
  });
});
