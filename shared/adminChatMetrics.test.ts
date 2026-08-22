import { describe, expect, it } from 'vitest';
import {
  calculateNetCashFlow,
  deriveClassTuitionRankingBand,
  isNearlyPaidRatio,
  mapUserPhraseToFinanceMetric,
  normalizeAdminMetrics,
  resolvePeriodBounds,
} from './adminChatMetrics.js';

describe('adminChatMetrics glossary and helpers', () => {
  it('maps "doanh thu dự kiến" to net_billed, not cash_in', () => {
    expect(mapUserPhraseToFinanceMetric('doanh thu dự kiến')).toBe('net_billed');
    expect(mapUserPhraseToFinanceMetric('doanh thu dự kiến tháng')).toBe('net_billed');
    expect(mapUserPhraseToFinanceMetric('phải thu ròng')).toBe('net_billed');
  });

  it('maps "đã thu thực tế" to cash_in, not collected_cohort', () => {
    expect(mapUserPhraseToFinanceMetric('đã thu thực tế')).toBe('cash_in');
    expect(mapUserPhraseToFinanceMetric('tiền thực thu')).toBe('cash_in');
    expect(mapUserPhraseToFinanceMetric('thực thu')).toBe('cash_in');
    expect(mapUserPhraseToFinanceMetric('đã thu trên cohort')).toBe('collected_cohort');
  });

  it('resolves current_month and previous_month across year boundary', () => {
    // Reference date: 2026-01-15T10:00:00+07:00 (Vietnam timezone)
    const janDate = new Date('2026-01-15T03:00:00Z');

    const currentPeriod = resolvePeriodBounds('current_month', janDate);
    expect(currentPeriod.monthKey).toBe('2026-01');
    expect(currentPeriod.startDate).toBe('2026-01-01');
    expect(currentPeriod.endDate).toBe('2026-01-31');
    expect(currentPeriod.displayLabel).toBe('Tháng 01/2026');

    const prevPeriod = resolvePeriodBounds('previous_month', janDate);
    expect(prevPeriod.monthKey).toBe('2025-12');
    expect(prevPeriod.startDate).toBe('2025-12-01');
    expect(prevPeriod.endDate).toBe('2025-12-31');
    expect(prevPeriod.displayLabel).toBe('Tháng 12/2025');
  });

  it('evaluates nearly-paid ratio strictly within [90%, 100%) and handles zero netDue safely', () => {
    expect(isNearlyPaidRatio(900_000, 1_000_000)).toBe(true);
    expect(isNearlyPaidRatio(950_000, 1_000_000)).toBe(true);
    expect(isNearlyPaidRatio(899_999, 1_000_000)).toBe(false);
    expect(isNearlyPaidRatio(1_000_000, 1_000_000)).toBe(false); // 100% is fully paid, not nearly paid
    expect(isNearlyPaidRatio(1_100_000, 1_000_000)).toBe(false); // overpaid

    // Zero / null checks
    expect(isNearlyPaidRatio(0, 0)).toBe(false);
    expect(isNearlyPaidRatio(0, null)).toBe(false);
    expect(isNearlyPaidRatio(null, 1_000_000)).toBe(false);
  });

  it('derives ranking band correctly for zero net due vs fully paid vs nearly paid vs incomplete', () => {
    // Zero net due -> no_receivable (not fully_paid)
    expect(
      deriveClassTuitionRankingBand({
        netDueTotal: 0,
        paidTotal: 0,
        outstandingTotal: 0,
        complete: true,
      })
    ).toBe('no_receivable');

    // Fully paid
    expect(
      deriveClassTuitionRankingBand({
        netDueTotal: 10_000_000,
        paidTotal: 10_000_000,
        outstandingTotal: 0,
        complete: true,
      })
    ).toBe('fully_paid');

    // Nearly paid (90% to <100%)
    expect(
      deriveClassTuitionRankingBand({
        netDueTotal: 10_000_000,
        paidTotal: 9_200_000,
        outstandingTotal: 800_000,
        complete: true,
      })
    ).toBe('nearly_paid');

    // Outstanding (<90%)
    expect(
      deriveClassTuitionRankingBand({
        netDueTotal: 10_000_000,
        paidTotal: 5_000_000,
        outstandingTotal: 5_000_000,
        complete: true,
      })
    ).toBe('outstanding');

    // Incomplete data or missing ledgers
    expect(
      deriveClassTuitionRankingBand({
        netDueTotal: 10_000_000,
        paidTotal: 10_000_000,
        outstandingTotal: 0,
        complete: false,
      })
    ).toBe('incomplete');

    expect(
      deriveClassTuitionRankingBand({
        netDueTotal: 10_000_000,
        paidTotal: 10_000_000,
        outstandingTotal: 0,
        complete: true,
        missingLedgerCount: 1,
      })
    ).toBe('incomplete');

    expect(
      deriveClassTuitionRankingBand({
        netDueTotal: null,
        paidTotal: 0,
        outstandingTotal: 0,
        complete: true,
      })
    ).toBe('incomplete');
  });

  it('normalizes multi-metric arrays, deduplicates, clamps to max 3, and preserves deterministic order', () => {
    const allowed = ['net_billed', 'cash_in', 'cash_out', 'discount'] as const;
    const raw = ['net_billed', 'cash_in', 'net_billed', 'discount', 'cash_out', 'unknown_metric'];
    const normalized = normalizeAdminMetrics(raw, allowed);

    expect(normalized).toEqual(['net_billed', 'cash_in', 'discount']);
  });

  it('calculates net cash flow preserving null safety without coercing null to 0', () => {
    expect(calculateNetCashFlow(10_000_000, 3_000_000)).toBe(7_000_000);
    expect(calculateNetCashFlow(null, 3_000_000)).toBeNull();
    expect(calculateNetCashFlow(10_000_000, null)).toBeNull();
    expect(calculateNetCashFlow(undefined, undefined)).toBeNull();
  });
});
