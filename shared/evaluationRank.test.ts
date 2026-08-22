import { describe, expect, it } from 'vitest';
import {
  getEvaluationRankDiscount,
  getEvaluationRankTemplateLabel,
  isRankedEvaluation,
  normalizeEvaluationRank,
} from './evaluationRank';

describe('evaluation rank helpers', () => {
  it('normalizes supported rank values and defaults unknown values to none', () => {
    expect(normalizeEvaluationRank('first')).toBe('first');
    expect(normalizeEvaluationRank('second')).toBe('second');
    expect(normalizeEvaluationRank('none')).toBe('none');
    expect(normalizeEvaluationRank('gold')).toBe('none');
    expect(normalizeEvaluationRank(undefined)).toBe('none');
    expect(normalizeEvaluationRank(null)).toBe('none');
  });

  it('detects only first and second as ranked evaluations', () => {
    expect(isRankedEvaluation('first')).toBe(true);
    expect(isRankedEvaluation('second')).toBe(true);
    expect(isRankedEvaluation('none')).toBe(false);
    expect(isRankedEvaluation('')).toBe(false);
  });

  it('formats rank template labels and discounts for Zalo', () => {
    expect(getEvaluationRankTemplateLabel('first')).toBe('HẠNG NHẤT');
    expect(getEvaluationRankTemplateLabel('second')).toBe('HẠNG NHÌ');
    expect(getEvaluationRankTemplateLabel('none')).toBe('');
    expect(getEvaluationRankDiscount('first')).toBe('10%');
    expect(getEvaluationRankDiscount('second')).toBe('5%');
    expect(getEvaluationRankDiscount('none')).toBe('');
  });
});
