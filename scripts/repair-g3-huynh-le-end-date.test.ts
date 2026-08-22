import { describe, expect, it } from 'vitest';
import {
  EXPECTED_G3_HUYNH_LE_SESSION_DATES,
  planG3HuynhLeEndDateRepair,
} from './repair-g3-huynh-le-end-date.js';

const source = {
  id: 'MbEjkY4bZPvUt9ykRpPu',
  name: 'G3 - Huynh Le T4-T6',
  startDate: '2026-05-13',
  endDate: '2026-07-03',
  daysOfWeek: [3, 5],
};

describe('G3 Huynh Le end-date repair', () => {
  it('plans only the grandfathered 24-session course correction', () => {
    expect(
      planG3HuynhLeEndDateRepair({
        classData: source,
        sessionDates: EXPECTED_G3_HUYNH_LE_SESSION_DATES,
      })
    ).toEqual({ decision: 'update', before: '2026-07-03', after: '2026-07-31' });
  });

  it('is idempotent after the exact correction', () => {
    expect(
      planG3HuynhLeEndDateRepair({
        classData: { ...source, endDate: '2026-07-31' },
        sessionDates: EXPECTED_G3_HUYNH_LE_SESSION_DATES,
      })
    ).toEqual({ decision: 'noop', before: '2026-07-31', after: '2026-07-31' });
  });

  it.each([
    [{ ...source, id: 'another-class' }, EXPECTED_G3_HUYNH_LE_SESSION_DATES],
    [{ ...source, name: 'G3 another teacher' }, EXPECTED_G3_HUYNH_LE_SESSION_DATES],
    [{ ...source, startDate: '2026-05-14' }, EXPECTED_G3_HUYNH_LE_SESSION_DATES],
    [source, EXPECTED_G3_HUYNH_LE_SESSION_DATES.slice(0, 23)],
  ])('blocks any source or 24-session evidence mismatch', (classData, sessionDates) => {
    expect(() => planG3HuynhLeEndDateRepair({ classData, sessionDates })).toThrow(
      'G3_HUYNH_LE_REPAIR_PRECONDITION_FAILED'
    );
  });
});
