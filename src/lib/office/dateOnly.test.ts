import { describe, expect, it } from 'vitest';
import {
  dateOnlyTimestamp,
  daysBetweenDateOnly,
  formatDateOnlyDisplay,
  formatDateOnlyShort,
  normalizeDateOnly,
  toVietnamDateOnly,
} from './dateOnly';

describe('office date-only helpers', () => {
  it('normalizes date-only and ISO datetime inputs', () => {
    expect(normalizeDateOnly('2026-05-31')).toBe('2026-05-31');
    expect(normalizeDateOnly('2026-05-31T00:00:00Z')).toBe('2026-05-31');
    expect(normalizeDateOnly(' 2026-05-31T17:45:00.000Z ')).toBe('2026-05-31');
  });

  it('rejects malformed or impossible dates instead of returning epoch zero', () => {
    expect(normalizeDateOnly('not-a-date')).toBe('');
    expect(normalizeDateOnly('2026-02-30')).toBe('');
    expect(dateOnlyTimestamp('not-a-date')).toBeNull();
  });

  it('computes UTC date-only timestamps and day differences', () => {
    expect(dateOnlyTimestamp('2026-06-01')).toBe(Date.UTC(2026, 5, 1));
    expect(daysBetweenDateOnly('2026-06-01', '2026-06-08')).toBe(7);
    expect(daysBetweenDateOnly('bad', '2026-06-08')).toBeNull();
  });

  it('formats short dates from date-only and ISO inputs', () => {
    expect(formatDateOnlyShort('2026-05-31')).toBe('31/05');
    expect(formatDateOnlyShort('2026-05-31T00:00:00Z')).toBe('31/05');
    expect(formatDateOnlyShort('bad', '-')).toBe('-');
  });

  it('formats user-facing date-only values as dd/MM/yyyy', () => {
    expect(formatDateOnlyDisplay('2026-05-31')).toBe('31/05/2026');
    expect(formatDateOnlyDisplay('2026-05-31T00:00:00Z')).toBe('31/05/2026');
    expect(formatDateOnlyDisplay('bad', '-')).toBe('-');
  });

  it('formats server timestamps as Vietnam date-only strings', () => {
    expect(toVietnamDateOnly(Date.parse('2026-06-10T18:00:00.000Z'))).toBe('2026-06-11');
  });
});
