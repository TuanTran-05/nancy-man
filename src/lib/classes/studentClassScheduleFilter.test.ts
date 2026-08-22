import { describe, expect, it } from 'vitest';
import type { Class } from '../../types';
import {
  filterStudentClassesBySchedule,
  getStudentClassStartTimes,
  matchesStudentClassScheduleFilter,
} from './studentClassScheduleFilter';

function makeClass(id: string, overrides: Partial<Class> = {}): Class {
  return {
    id,
    name: id,
    schedule: '',
    daysOfWeek: [],
    description: '',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    startTime: '',
    teacherId: 'teacher-1',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('studentClassScheduleFilter', () => {
  const structured = makeClass('structured', {
    weeklySessions: [
      { dayOfWeek: 2, startTime: '17:30', endTime: '19:00' },
      { dayOfWeek: 4, startTime: '18:30', endTime: '20:00' },
    ],
  });

  it('keeps every class when no schedule filter is selected', () => {
    expect(
      matchesStudentClassScheduleFilter(structured, {
        dayOfWeek: null,
        startTime: null,
      })
    ).toBe(true);
  });

  it('requires weekday and start time to match the same session', () => {
    expect(
      matchesStudentClassScheduleFilter(structured, {
        dayOfWeek: 2,
        startTime: '17:30',
      })
    ).toBe(true);
    expect(
      matchesStudentClassScheduleFilter(structured, {
        dayOfWeek: 2,
        startTime: '18:30',
      })
    ).toBe(false);
  });

  it('supports legacy schedules and preserves input order', () => {
    const legacy = makeClass('legacy', {
      daysOfWeek: [2],
      startTime: '17:30',
      schedule: '17:30-19:00',
    });

    expect(
      filterStudentClassesBySchedule([structured, legacy], {
        dayOfWeek: 2,
        startTime: '17:30',
      }).map((item) => item.id)
    ).toEqual(['structured', 'legacy']);
  });

  it('returns unique sorted start times and ignores classes without valid schedules', () => {
    const duplicate = makeClass('duplicate', {
      weeklySessions: [{ dayOfWeek: 3, startTime: '17:30', endTime: '19:00' }],
    });
    const early = makeClass('early', {
      weeklySessions: [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:30' }],
    });
    const missing = makeClass('missing');

    expect(getStudentClassStartTimes([structured, duplicate, early, missing])).toEqual([
      '08:00',
      '17:30',
      '18:30',
    ]);
    expect(
      matchesStudentClassScheduleFilter(missing, {
        dayOfWeek: 2,
        startTime: null,
      })
    ).toBe(false);
  });
});
