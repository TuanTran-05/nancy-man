import { describe, expect, it } from 'vitest';
import { formatVndAmount } from './moneyFormat';

describe('formatVndAmount', () => {
  it('formats PostgreSQL decimal strings as whole Vietnamese dong amounts', () => {
    expect(formatVndAmount('250000.00')).toBe('250.000');
  });

  it('formats numeric amounts without decimal places', () => {
    expect(formatVndAmount(250000)).toBe('250.000');
  });

  it('does not expose invalid values to the UI', () => {
    expect(formatVndAmount('not-a-number')).toBe('0');
  });
});
