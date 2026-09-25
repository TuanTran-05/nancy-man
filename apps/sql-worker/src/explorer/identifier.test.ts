import { describe, expect, it } from 'vitest';
import { quoteIdentifier } from './identifier.js';

describe('quoteIdentifier', () => {
  it('quotes simple identifiers', () => {
    expect(quoteIdentifier('students')).toBe('"students"');
    expect(quoteIdentifier('public')).toBe('"public"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(quoteIdentifier('odd"column')).toBe('"odd""column"');
    expect(quoteIdentifier('table"with""quotes')).toBe('"table""with""""quotes"');
  });

  it('preserves uppercase and special characters without interpreting SQL syntax', () => {
    expect(quoteIdentifier('Odd Schema')).toBe('"Odd Schema"');
    expect(quoteIdentifier('select')).toBe('"select"');
    expect(quoteIdentifier('user; DROP TABLE students; --')).toBe(
      '"user; DROP TABLE students; --"'
    );
  });
});
