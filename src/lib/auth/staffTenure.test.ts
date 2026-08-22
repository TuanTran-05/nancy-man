import { describe, expect, it } from 'vitest';
import { calculateStaffTenure } from './staffTenure';

describe('calculateStaffTenure', () => {
  it('returns zero duration for two instants on the same Vietnam calendar day', () => {
    expect(
      calculateStaffTenure('2026-07-14T17:00:00.000Z', new Date('2026-07-15T16:59:59.000Z'))
    ).toEqual({ years: 0, months: 0, days: 0 });
  });

  it('returns complete years, months, and days', () => {
    expect(
      calculateStaffTenure('2023-05-10T03:00:00.000Z', new Date('2026-07-15T05:00:00.000Z'))
    ).toEqual({ years: 3, months: 2, days: 5 });
  });

  it('clamps a leap-day anniversary to the last day of February', () => {
    expect(
      calculateStaffTenure('2020-02-28T17:00:00.000Z', new Date('2021-02-28T05:00:00.000Z'))
    ).toEqual({ years: 1, months: 0, days: 0 });
  });

  it.each([
    ['2024-02-28T05:00:00.000Z', { years: 3, months: 11, days: 30 }],
    ['2024-02-29T05:00:00.000Z', { years: 4, months: 0, days: 0 }],
    ['2024-03-01T05:00:00.000Z', { years: 4, months: 0, days: 1 }],
  ])('keeps leap-day tenure normalized through %s', (asOf, expected) => {
    expect(calculateStaffTenure('2020-02-28T17:00:00.000Z', new Date(asOf))).toEqual(expected);
  });

  it('clamps a month-end anniversary', () => {
    expect(
      calculateStaffTenure('2023-01-30T17:00:00.000Z', new Date('2023-02-28T05:00:00.000Z'))
    ).toEqual({ years: 0, months: 1, days: 0 });
  });

  it('uses Asia Ho Chi Minh when UTC crosses into the next local day', () => {
    expect(
      calculateStaffTenure('2023-12-31T18:00:00.000Z', new Date('2024-01-02T05:00:00.000Z'))
    ).toEqual({ years: 0, months: 0, days: 1 });
  });

  it.each([
    [undefined, new Date('2026-07-15T05:00:00.000Z')],
    ['', new Date('2026-07-15T05:00:00.000Z')],
    ['not-a-date', new Date('2026-07-15T05:00:00.000Z')],
    ['2026-07-16T05:00:00.000Z', new Date('2026-07-15T05:00:00.000Z')],
    ['2020-01-01T00:00:00.000Z', new Date('invalid')],
  ])('returns null for invalid or future input %#', (createdAt, asOf) => {
    expect(calculateStaffTenure(createdAt, asOf)).toBeNull();
  });
});
