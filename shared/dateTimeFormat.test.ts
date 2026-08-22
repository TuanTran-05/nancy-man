import { describe, expect, it } from 'vitest';
import {
  apiDateToDisplayDate,
  apiDateTimeToDisplayDateTime,
  apiTimeToDisplayTime,
  dateToApiDate,
  dateToApiDateInTimeZone,
  dateToApiMonthInTimeZone,
  isApiDateOnly,
  isApiMonth,
  isApiDateTime,
  isApiTimeOnly,
  normalizeDateLikeToApiDate,
  normalizeUserDateInput,
  normalizeUserDateTimeInput,
  normalizeUserTimeInput,
  userDateTimeToApiIso,
  userDateToApiDate,
} from './dateTimeFormat';

describe('date time format helpers', () => {
  describe('normalizeUserDateInput', () => {
    it('pads day and month while keeping valid dates strict', () => {
      expect(normalizeUserDateInput('9/5/2025')).toBe('09/05/2025');
      expect(normalizeUserDateInput('09/05/2025')).toBe('09/05/2025');
      expect(normalizeUserDateInput('29/02/2024')).toBe('29/02/2024');
    });

    it('rejects impossible dates', () => {
      expect(() => normalizeUserDateInput('31/04/2025')).toThrow('Invalid date');
      expect(() => normalizeUserDateInput('29/02/2025')).toThrow('Invalid date');
      expect(() => normalizeUserDateInput('00/05/2025')).toThrow('Invalid date');
      expect(() => normalizeUserDateInput('05/00/2025')).toThrow('Invalid date');
    });
  });

  describe('normalizeUserTimeInput', () => {
    it('pads time and defaults missing seconds to zero', () => {
      expect(normalizeUserTimeInput('5:9')).toBe('05:09:00');
      expect(normalizeUserTimeInput('5:9:3')).toBe('05:09:03');
      expect(normalizeUserTimeInput('05:09')).toBe('05:09:00');
      expect(normalizeUserTimeInput('05:09:03')).toBe('05:09:03');
    });

    it('rejects invalid time ranges', () => {
      expect(() => normalizeUserTimeInput('24:00')).toThrow('Invalid time');
      expect(() => normalizeUserTimeInput('12:60')).toThrow('Invalid time');
      expect(() => normalizeUserTimeInput('12:30:60')).toThrow('Invalid time');
    });
  });

  describe('normalizeUserDateTimeInput', () => {
    it('normalizes time plus date separated by whitespace', () => {
      expect(normalizeUserDateTimeInput('5:9 9/5/2025')).toBe('05:09:00 09/05/2025');
      expect(normalizeUserDateTimeInput('5:9:3 9/5/2025')).toBe('05:09:03 09/05/2025');
      expect(normalizeUserDateTimeInput('05:09:03 09/05/2025')).toBe('05:09:03 09/05/2025');
    });

    it('rejects missing date or invalid date-time parts', () => {
      expect(() => normalizeUserDateTimeInput('05:09')).toThrow('Invalid datetime');
      expect(() => normalizeUserDateTimeInput('05:09 31/04/2025')).toThrow('Invalid date');
      expect(() => normalizeUserDateTimeInput('24:00 09/05/2025')).toThrow('Invalid time');
    });
  });

  describe('canonical API conversions', () => {
    it('converts display dates to API date-only strings and back', () => {
      expect(userDateToApiDate('9/5/2025')).toBe('2025-05-09');
      expect(apiDateToDisplayDate('2025-05-09')).toBe('09/05/2025');
      expect(dateToApiDate(new Date(2025, 4, 9))).toBe('2025-05-09');
    });

    it('accepts old ISO date-only values where compatibility is needed', () => {
      expect(normalizeDateLikeToApiDate('2025-05-09')).toBe('2025-05-09');
      expect(normalizeDateLikeToApiDate('9/5/2025')).toBe('2025-05-09');
    });

    it('identifies canonical API formats', () => {
      expect(isApiMonth('2026-04')).toBe(true);
      expect(isApiMonth('2026-99')).toBe(false);
      expect(isApiMonth('0000-04')).toBe(false);
      expect(isApiDateOnly('2025-05-09')).toBe(true);
      expect(isApiDateOnly('09/05/2025')).toBe(false);
      expect(isApiTimeOnly('05:09:03')).toBe(true);
      expect(isApiTimeOnly('05:09')).toBe(false);
      expect(isApiDateTime('2025-05-08T22:09:00.000Z')).toBe(true);
      expect(isApiDateTime('05:09:00 09/05/2025')).toBe(false);
    });
  });

  describe('datetime timezone conversion', () => {
    it('derives business dates and months in Vietnam time', () => {
      const instant = new Date('2026-06-30T18:00:00.000Z');
      expect(dateToApiDateInTimeZone(instant)).toBe('2026-07-01');
      expect(dateToApiMonthInTimeZone(instant)).toBe('2026-07');
    });

    it('converts user datetime in Vietnam time to ISO 8601', () => {
      expect(userDateTimeToApiIso('5:9 9/5/2025')).toBe('2025-05-08T22:09:00.000Z');
    });

    it('formats API ISO datetimes for display in Vietnam time', () => {
      expect(apiDateTimeToDisplayDateTime('2025-05-08T22:09:00.000Z')).toBe('09/05/2025 05:09');
      expect(apiTimeToDisplayTime('05:09:00')).toBe('05:09:00');
    });
  });
});
