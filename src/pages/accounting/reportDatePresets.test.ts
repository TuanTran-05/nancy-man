import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getReportDatePresets } from './reportDatePresets';

const originalTimezone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Asia/Ho_Chi_Minh';
});

afterAll(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

describe('getReportDatePresets', () => {
  it('builds today, current quarter, and current year from the local calendar date', () => {
    const presets = getReportDatePresets(new Date(2026, 7, 6, 0, 30));

    expect(presets.today).toEqual({ from: '2026-08-06', to: '2026-08-06' });
    expect(presets.thisQuarter).toEqual({ from: '2026-07-01', to: '2026-08-06' });
    expect(presets.thisYear).toEqual({ from: '2026-01-01', to: '2026-08-06' });
  });

  it('uses complete calendar months', () => {
    const presets = getReportDatePresets(new Date(2026, 7, 6, 8));

    expect(presets.thisMonth).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(presets.lastMonth).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('crosses the year boundary without changing the intended local day', () => {
    const presets = getReportDatePresets(new Date(2026, 0, 15, 8));

    expect(presets.lastMonth).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presets.lastYear).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
});
