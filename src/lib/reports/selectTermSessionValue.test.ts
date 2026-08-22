import { describe, expect, it } from 'vitest';
import { selectTermSessionValue } from './selectTermSessionValue';
import { ALL } from './studentReportFilter';
import type { TermSessionValue } from '../api/studentAdminReportApi';

const VALUE: TermSessionValue = {
  courseTotalSessions: 40,
  pricePerSession: 150_000,
  refundable: { sessions: 3, amount: 450_000 },
  notEnrolled: { sessions: 0, amount: 0 },
};

describe('selectTermSessionValue', () => {
  it('returns the selected term entry', () => {
    const byTerm = { 'class-1::current': VALUE };
    expect(selectTermSessionValue(byTerm, { termKey: 'class-1::current' })).toEqual(VALUE);
  });

  it('returns null when all courses are selected', () => {
    const byTerm = { 'class-1::current': VALUE };
    expect(selectTermSessionValue(byTerm, { termKey: ALL })).toBeNull();
  });

  it('returns null while a date range is active', () => {
    const byTerm = { 'class-1::current': VALUE };
    expect(
      selectTermSessionValue(byTerm, { termKey: 'class-1::current', from: '2026-01-01' })
    ).toBeNull();
    expect(
      selectTermSessionValue(byTerm, { termKey: 'class-1::current', to: '2026-12-31' })
    ).toBeNull();
  });

  it('returns null when the term has no entry (non-admin, or unpriceable)', () => {
    expect(selectTermSessionValue({}, { termKey: 'class-1::current' })).toBeNull();
  });
});
