import { describe, expect, it } from 'vitest';
import { estimateSessionValue } from './studentRefundEstimate.js';

const BASE = {
  courseFee: 6_000_000,
  courseTotalSessions: 40,
  excusedAbsences: 0,
  onLeaveSessions: 0,
  notEnrolledSessions: 0,
};

describe('estimateSessionValue', () => {
  it('divides the course fee by the whole-course session count', () => {
    const result = estimateSessionValue(BASE);
    expect(result.pricePerSession).toBe(150_000);
  });

  it('counts excused absences as refundable', () => {
    const result = estimateSessionValue({ ...BASE, excusedAbsences: 3 });
    expect(result.refundable).toEqual({ sessions: 3, amount: 450_000 });
  });

  it('counts on-leave sessions as refundable alongside excused absences', () => {
    const result = estimateSessionValue({ ...BASE, excusedAbsences: 3, onLeaveSessions: 5 });
    expect(result.refundable).toEqual({ sessions: 8, amount: 1_200_000 });
  });

  // Spec D2: money never paid is not a refund.
  it('reports not-enrolled sessions separately from refundable ones', () => {
    const result = estimateSessionValue({
      ...BASE,
      excusedAbsences: 2,
      notEnrolledSessions: 20,
    });
    expect(result.refundable).toEqual({ sessions: 2, amount: 300_000 });
    expect(result.notEnrolled).toEqual({ sessions: 20, amount: 3_000_000 });
  });

  it('returns null price when the course has no sessions', () => {
    const result = estimateSessionValue({ ...BASE, courseTotalSessions: 0, excusedAbsences: 3 });
    expect(result.pricePerSession).toBeNull();
    expect(result.refundable).toEqual({ sessions: 3, amount: 0 });
  });

  it('returns null price when the course fee is zero or missing', () => {
    expect(estimateSessionValue({ ...BASE, courseFee: 0 }).pricePerSession).toBeNull();
    expect(estimateSessionValue({ ...BASE, courseFee: -1 }).pricePerSession).toBeNull();
  });

  it('returns null price for non-finite input rather than NaN', () => {
    expect(estimateSessionValue({ ...BASE, courseFee: Number.NaN }).pricePerSession).toBeNull();
    expect(
      estimateSessionValue({ ...BASE, courseTotalSessions: Number.POSITIVE_INFINITY })
        .pricePerSession,
    ).toBeNull();
  });

  it('rounds the per-session price to whole dong', () => {
    // 1,000,000 / 3 = 333,333.33...
    const result = estimateSessionValue({
      ...BASE,
      courseFee: 1_000_000,
      courseTotalSessions: 3,
      excusedAbsences: 3,
    });
    expect(result.pricePerSession).toBe(333_333);
    expect(result.refundable.amount).toBe(999_999);
  });

  it('clamps negative session counts to zero', () => {
    const result = estimateSessionValue({ ...BASE, excusedAbsences: -5 });
    expect(result.refundable).toEqual({ sessions: 0, amount: 0 });
  });

  it('reports zeroes when nothing was missed', () => {
    const result = estimateSessionValue(BASE);
    expect(result.refundable).toEqual({ sessions: 0, amount: 0 });
    expect(result.notEnrolled).toEqual({ sessions: 0, amount: 0 });
  });
});

