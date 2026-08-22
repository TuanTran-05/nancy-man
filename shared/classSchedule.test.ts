import { describe, expect, it } from 'vitest';
import {
  formatWeeklyClassSchedule,
  getClassSessionForDate,
  getClassTimeRangeForDate,
  getClassTimeRange,
  getScheduledClassDatesInRange,
  getWeeklyClassSessions,
  isIsoDate,
  isScheduledClassDate,
  isWithinClassDateRange,
  isExpectedClassSessionOnDate,
} from './classSchedule';

describe('class schedule helpers', () => {
  it('validates ISO date strings strictly', () => {
    expect(isIsoDate('2026-06-01')).toBe(true);
    expect(isIsoDate('2026-6-1')).toBe(false);
    expect(isIsoDate('bad')).toBe(false);
  });

  it('generates fixed scheduled dates only inside class start and end date', () => {
    const dates = getScheduledClassDatesInRange(
      {
        startDate: '2026-06-10',
        endDate: '2026-06-20',
        daysOfWeek: [1, 3, 5],
      },
      '2026-06-01',
      '2026-06-30'
    );

    expect(dates).toEqual(['2026-06-10', '2026-06-12', '2026-06-15', '2026-06-17', '2026-06-19']);
  });

  it('allows dates inside range and rejects dates outside range', () => {
    const cls = { startDate: '2026-06-01', endDate: '2026-06-15' };
    expect(isWithinClassDateRange(cls, '2026-06-01')).toBe(true);
    expect(isWithinClassDateRange(cls, '2026-06-15')).toBe(true);
    expect(isWithinClassDateRange(cls, '2026-05-31')).toBe(false);
    expect(isWithinClassDateRange(cls, '2026-06-16')).toBe(false);
  });

  it('formats class time from startTime and schedule fallback', () => {
    expect(getClassTimeRange({ startTime: '17:30', schedule: '' })).toBe('17:30 - 19:00');
    expect(getClassTimeRange({ startTime: '17:30:00', schedule: '' })).toBe('17:30 - 19:00');
    expect(getClassTimeRange({ schedule: '18:00 - 19:30' })).toBe('18:00 - 19:30');
    expect(getClassTimeRange({ schedule: '18:00:00 - 19:30:00' })).toBe('18:00 - 19:30');
    expect(getClassTimeRange({})).toBe('--:--');
  });

  it('resolves weeklySessions with different weekday times', () => {
    const cls = {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      daysOfWeek: [1, 3],
      startTime: '17:30:00',
      schedule: '17:30 - 19:00',
      room: 'Default Room',
      weeklySessions: [
        { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
        { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
      ],
    };

    expect(getWeeklyClassSessions(cls)).toEqual([
      {
        dayOfWeek: 1,
        startTime: '17:30',
        endTime: '19:00',
        schedule: '17:30 - 19:00',
        room: 'Default Room',
        source: 'weeklySessions',
      },
      {
        dayOfWeek: 3,
        startTime: '19:15',
        endTime: '20:45',
        schedule: '19:15 - 20:45',
        room: 'Room 4',
        source: 'weeklySessions',
      },
    ]);
    expect(getClassSessionForDate(cls, '2026-06-02')).toBeNull();
    expect(getClassTimeRangeForDate(cls, '2026-06-01')).toBe('17:30 - 19:00');
    expect(getClassTimeRangeForDate(cls, '2026-06-03')).toBe('19:15 - 20:45');
    expect(formatWeeklyClassSchedule(cls, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])).toBe(
      'Mon 17:30 - 19:00 | Wed 19:15 - 20:45'
    );
  });

  it('uses weeklySessions for scheduled date generation', () => {
    const cls = {
      startDate: '2026-06-01',
      endDate: '2026-06-10',
      daysOfWeek: [2],
      weeklySessions: [
        { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
        { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00' },
      ],
    };

    expect(getScheduledClassDatesInRange(cls, '2026-06-01', '2026-06-10')).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-08',
      '2026-06-10',
    ]);
    expect(isScheduledClassDate(cls, '2026-06-02')).toBe(false);
  });

  it('falls back to legacy daysOfWeek startTime and schedule when weeklySessions is absent', () => {
    const cls = {
      daysOfWeek: [1, 3],
      startTime: '17:30:00',
      schedule: '17:30 - 19:00',
      room: 'Room 2',
    };

    expect(getWeeklyClassSessions(cls)).toEqual([
      {
        dayOfWeek: 1,
        startTime: '17:30',
        endTime: '19:00',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        source: 'legacy',
      },
      {
        dayOfWeek: 3,
        startTime: '17:30',
        endTime: '19:00',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        source: 'legacy',
      },
    ]);
  });

  it('falls back to legacy schedule range when startTime is missing', () => {
    const cls = {
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      daysOfWeek: [1, 3],
      schedule: '18:00 - 19:30',
    };

    expect(getWeeklyClassSessions(cls)).toEqual([
      {
        dayOfWeek: 1,
        startTime: '18:00',
        endTime: '19:30',
        schedule: '18:00 - 19:30',
        source: 'legacy',
      },
      {
        dayOfWeek: 3,
        startTime: '18:00',
        endTime: '19:30',
        schedule: '18:00 - 19:30',
        source: 'legacy',
      },
    ]);
    expect(getClassSessionForDate(cls, '2026-06-02')).toBeNull();
    expect(getClassTimeRangeForDate(cls, '2026-06-03')).toBe('18:00 - 19:30');
  });

  it('detects whether a single date is a real scheduled class date', () => {
    const cls = {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      daysOfWeek: [1, 3],
    };

    expect(isScheduledClassDate(cls, '2026-06-01')).toBe(true);
    expect(isScheduledClassDate(cls, '2026-06-03')).toBe(true);
    expect(isScheduledClassDate(cls, '2026-06-02')).toBe(false);
    expect(isScheduledClassDate(cls, '2026-05-25')).toBe(false);
    expect(isScheduledClassDate(cls, '2026-07-01')).toBe(false);
    expect(isScheduledClassDate({ ...cls, daysOfWeek: [] }, '2026-06-01')).toBe(false);
  });

  describe('isExpectedClassSessionOnDate', () => {
    const cls = {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      daysOfWeek: [1, 3], // Mon, Wed
      status: 'active',
      holidays: ['2026-06-15'],
    };

    it('returns true on regular scheduled days', () => {
      // 2026-06-01 is Monday (1)
      expect(isExpectedClassSessionOnDate(cls, '2026-06-01')).toBe(true);
      // 2026-06-03 is Wednesday (3)
      expect(isExpectedClassSessionOnDate(cls, '2026-06-03')).toBe(true);
    });

    it('returns false on non-scheduled weekdays', () => {
      // 2026-06-02 is Tuesday (2)
      expect(isExpectedClassSessionOnDate(cls, '2026-06-02')).toBe(false);
    });

    it('returns false for dates before startDate or after endDate', () => {
      // Before startDate
      expect(isExpectedClassSessionOnDate(cls, '2026-05-25')).toBe(false);
      // After endDate
      expect(isExpectedClassSessionOnDate(cls, '2026-07-01')).toBe(false);
    });

    it('returns false if the class is archived', () => {
      const archivedCls = { ...cls, status: 'archived' };
      expect(isExpectedClassSessionOnDate(archivedCls, '2026-06-01')).toBe(false);
    });

    it('returns false for dates in class holidays', () => {
      expect(isExpectedClassSessionOnDate(cls, '2026-06-15')).toBe(false);
    });

    it('returns false for dates in system holidays', () => {
      const systemHolidays = ['2026-06-08'];
      expect(isExpectedClassSessionOnDate(cls, '2026-06-08', systemHolidays)).toBe(false);
    });
  });
});
