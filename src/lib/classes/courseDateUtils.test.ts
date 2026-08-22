import { describe, expect, it } from 'vitest';
import { calculateEndDate, getRequiredSessions, suggestEndDate } from './courseDateUtils';

describe('getRequiredSessions', () => {
  it('returns 16 for grade 1', () => {
    expect(getRequiredSessions(1)).toBe(16);
  });
  it('returns 16 for grade 2', () => {
    expect(getRequiredSessions(2)).toBe(16);
  });
  it('returns 16 for grade 3', () => {
    expect(getRequiredSessions(3)).toBe(16);
  });
  it('returns 16 for grade 12', () => {
    expect(getRequiredSessions(12)).toBe(16);
  });
  it('returns 16 when no grade provided', () => {
    expect(getRequiredSessions(undefined)).toBe(16);
  });
});

describe('calculateEndDate', () => {
  it('calculates end date for 16 sessions on Mon/Wed/Fri with no holidays', () => {
    const result = calculateEndDate('2026-06-01', 16, [1, 3, 5], []);
    expect(result).toBe('2026-07-06');
  });

  it('calculates end date for 16 sessions on Tue/Thu with no holidays', () => {
    const result = calculateEndDate('2026-06-02', 16, [2, 4], []);
    expect(result).toBe('2026-07-23');
  });

  it('skips system holidays that fall on class days', () => {
    const result = calculateEndDate('2026-06-01', 16, [1, 3, 5], ['2026-06-15']);
    expect(result).toBe('2026-07-08');
  });

  it('handles start date that is not a class day', () => {
    const result = calculateEndDate('2026-05-31', 16, [1, 3, 5], []);
    expect(result).toBe('2026-07-06');
  });

  it('handles multiple holidays', () => {
    const result = calculateEndDate('2026-06-01', 16, [1, 3, 5], ['2026-06-15', '2026-06-17']);
    expect(result).toBe('2026-07-10');
  });

  it('ignores holidays outside the course period', () => {
    const result = calculateEndDate('2026-06-01', 16, [1, 3, 5], ['2026-01-01']);
    expect(result).toBe('2026-07-06');
  });
});

describe('suggestEndDate', () => {
  it('suggests a 16-session end date when grade has not been selected yet', () => {
    const result = suggestEndDate({
      startDate: '2026-06-01',
      grade: undefined,
      daysOfWeek: [1, 3, 5],
      holidays: [],
    });

    expect(result).toBe('2026-07-06');
  });

  it('falls back to the start date weekday until class days are selected', () => {
    const result = suggestEndDate({
      startDate: '2026-06-01',
      grade: undefined,
      daysOfWeek: [],
      holidays: [],
    });

    expect(result).toBe('2026-09-14');
  });
});
