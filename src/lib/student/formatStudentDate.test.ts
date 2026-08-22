import { describe, expect, it } from 'vitest';
import { formatStudentDate } from './formatStudentDate';

describe('formatStudentDate', () => {
  it('formats a valid canonical date for display', () => {
    expect(formatStudentDate('2012-05-09')).toBe('09/05/2012');
  });

  it.each(['2025-02-30', '0000-00-00'])('preserves the invalid canonical value %s', (value) => {
    expect(formatStudentDate(value)).toBe(value);
  });

  it('formats a parseable datetime in the Vietnam timezone', () => {
    expect(formatStudentDate('2012-05-09T00:00:00.000Z')).toBe('09/05/2012');
  });

  it('preserves an invalid non-canonical value', () => {
    expect(formatStudentDate('not-a-date')).toBe('not-a-date');
  });

  it.each([undefined, ''])('returns an empty string for %s', (value) => {
    expect(formatStudentDate(value)).toBe('');
  });
});
