import { describe, expect, it } from 'vitest';
import { formatDate } from './financeUtils';

describe('accounting finance date formatting', () => {
  it('formats canonical date-only strings for display', () => {
    expect(formatDate('2026-06-05', 'vi')).toBe('05/06/2026');
  });

  it('keeps DocumentStore timestamp-like values supported', () => {
    expect(
      formatDate({ seconds: Date.parse('2026-06-05T10:30:00.000Z') / 1000, nanoseconds: 0 }, 'vi')
    ).toBe('05/06/2026');
  });

  it('uses dd/MM/yyyy for parseable fallback strings in every UI language', () => {
    expect(formatDate('Fri, 05 Jun 2026 10:30:00 GMT', 'en')).toBe('05/06/2026');
  });
});
