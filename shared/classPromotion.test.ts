import { describe, expect, it } from 'vitest';
import {
  buildPromotionCutoffByClassId,
  clampEndDateToPromotion,
  isAfterPromotionCutoff,
} from './classPromotion';

describe('buildPromotionCutoffByClassId', () => {
  it('maps the source class to the promotion date recorded on the new class', () => {
    const cutoffs = buildPromotionCutoffByClassId([
      { importSourceClassId: 'old-1', promotedAt: '2026-06-27T15:25:43.407Z' },
    ]);
    expect(cutoffs.get('old-1')).toBe('2026-06-27');
  });

  it('accepts a DocumentStore timestamp', () => {
    const cutoffs = buildPromotionCutoffByClassId([
      { importSourceClassId: 'old-1', promotedAt: { toDate: () => new Date('2026-06-29T10:00:00Z') } },
    ]);
    expect(cutoffs.get('old-1')).toBe('2026-06-29');
  });

  it('keeps the earliest promotion when a class was used as source twice', () => {
    const cutoffs = buildPromotionCutoffByClassId([
      { importSourceClassId: 'old-1', promotedAt: '2026-07-10T00:00:00Z' },
      { importSourceClassId: 'old-1', promotedAt: '2026-06-27T00:00:00Z' },
    ]);
    expect(cutoffs.get('old-1')).toBe('2026-06-27');
  });

  it('ignores promotionLineage, which is documentation and must never cut payroll', () => {
    const cutoffs = buildPromotionCutoffByClassId([
      {
        promotionLineage: {
          sourceClassName: 'Advanced 8',
          recordedAt: '2026-05-19T08:18:42.445Z',
        },
      } as Record<string, unknown>,
    ]);
    expect(cutoffs.size).toBe(0);
  });

  it('ignores classes with no link or an unusable date', () => {
    const cutoffs = buildPromotionCutoffByClassId([
      { promotedAt: '2026-06-27T00:00:00Z' },
      { importSourceClassId: 'old-2' },
      { importSourceClassId: 'old-3', promotedAt: 'not-a-date' },
    ]);
    expect(cutoffs.size).toBe(0);
  });
});

describe('isAfterPromotionCutoff', () => {
  const cutoffs = new Map([['old-1', '2026-06-27']]);

  it('excludes the promotion day itself and everything after', () => {
    expect(isAfterPromotionCutoff(cutoffs, 'old-1', '2026-06-27')).toBe(true);
    expect(isAfterPromotionCutoff(cutoffs, 'old-1', '2026-07-19')).toBe(true);
  });

  it('keeps sessions taught before the promotion', () => {
    expect(isAfterPromotionCutoff(cutoffs, 'old-1', '2026-06-26')).toBe(false);
  });

  it('never touches a class that was not a promotion source', () => {
    expect(isAfterPromotionCutoff(cutoffs, 'other', '2026-07-19')).toBe(false);
  });
});

describe('clampEndDateToPromotion', () => {
  const cutoffs = new Map([['old-1', '2026-06-27']]);

  it('pulls the end date back to the day before the promotion', () => {
    expect(clampEndDateToPromotion(cutoffs, 'old-1', '2026-08-16')).toBe('2026-06-26');
  });

  it('leaves an earlier end date alone', () => {
    expect(clampEndDateToPromotion(cutoffs, 'old-1', '2026-06-01')).toBe('2026-06-01');
  });

  it('fills in an empty end date so the schedule stops', () => {
    expect(clampEndDateToPromotion(cutoffs, 'old-1', '')).toBe('2026-06-26');
  });

  it('leaves non-source classes untouched', () => {
    expect(clampEndDateToPromotion(cutoffs, 'other', '2026-08-16')).toBe('2026-08-16');
  });
});
