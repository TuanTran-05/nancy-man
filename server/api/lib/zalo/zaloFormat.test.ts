import { describe, expect, it } from 'vitest';
import { formatCoursePeriodForZalo, formatDateForZalo } from './zaloFormat';

describe('zalo date formatting', () => {
  it('formats date-only values for Zalo display', () => {
    expect(formatDateForZalo('2026-06-05')).toBe('05/06/2026');
    expect(formatDateForZalo('5/6/2026')).toBe('05/06/2026');
  });

  it('formats time-only and datetime values for Zalo display', () => {
    expect(formatDateForZalo('5:9')).toBe('05:09:00');
    expect(formatDateForZalo('5:9:3 5/6/2026')).toBe('05:09:03 05/06/2026');
  });

  it('formats course period from canonical class dates', () => {
    expect(formatCoursePeriodForZalo({ startDate: '2026-06-05', endDate: '2026-07-05' })).toBe(
      '05/06/2026 - 05/07/2026'
    );
  });

  it('returns invalid string inputs unchanged for backward compatibility', () => {
    expect(formatDateForZalo('not-a-date')).toBe('not-a-date');
  });
});
