import { describe, expect, it } from 'vitest';
import {
  computeSummaryPaidRatio,
  computeSummaryRankingBand,
  makeAdminClassTuitionSummaryDocId,
} from './adminClassTuitionSummary.js';

describe('adminClassTuitionSummary contract & helpers', () => {
  it('generates deterministic doc id from classId and termStart', () => {
    expect(makeAdminClassTuitionSummaryDocId('class_123', '2026-06-01')).toBe(
      'class_123__2026-06-01'
    );
  });

  it('computes paid ratio accurately rounded to 4 decimals', () => {
    expect(computeSummaryPaidRatio(950_000, 1_000_000)).toBe(0.95);
    expect(computeSummaryPaidRatio(0, 1_000_000)).toBe(0);
    expect(computeSummaryPaidRatio(1_000_000, 0)).toBe(0);
    expect(computeSummaryPaidRatio(null, 1_000_000)).toBeNull();
  });

  it('computes ranking band for complete and incomplete records', () => {
    expect(
      computeSummaryRankingBand({
        netDueTotal: 0,
        paidTotal: 0,
        outstandingTotal: 0,
        complete: true,
      })
    ).toBe('no_receivable');

    expect(
      computeSummaryRankingBand({
        netDueTotal: 5_000_000,
        paidTotal: 5_000_000,
        outstandingTotal: 0,
        complete: true,
      })
    ).toBe('fully_paid');

    expect(
      computeSummaryRankingBand({
        netDueTotal: 5_000_000,
        paidTotal: 4_700_000,
        outstandingTotal: 300_000,
        complete: true,
      })
    ).toBe('nearly_paid');

    expect(
      computeSummaryRankingBand({
        netDueTotal: 5_000_000,
        paidTotal: 1_000_000,
        outstandingTotal: 4_000_000,
        complete: true,
      })
    ).toBe('outstanding');

    expect(
      computeSummaryRankingBand({
        netDueTotal: 5_000_000,
        paidTotal: 5_000_000,
        outstandingTotal: 0,
        complete: false,
      })
    ).toBe('incomplete');
  });
});
