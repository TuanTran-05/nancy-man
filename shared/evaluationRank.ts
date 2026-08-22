export const EVALUATION_RANKS = ['none', 'first', 'second'] as const;

export type EvaluationRank = (typeof EVALUATION_RANKS)[number];
export type RankedEvaluationRank = Exclude<EvaluationRank, 'none'>;

export function normalizeEvaluationRank(value: unknown): EvaluationRank {
  return value === 'first' || value === 'second' ? value : 'none';
}

export function isRankedEvaluation(value: unknown): value is RankedEvaluationRank {
  return value === 'first' || value === 'second';
}

export function getEvaluationRankTemplateLabel(value: unknown): string {
  const rank = normalizeEvaluationRank(value);
  if (rank === 'first') return 'HẠNG NHẤT';
  if (rank === 'second') return 'HẠNG NHÌ';
  return '';
}

export function getEvaluationRankDiscount(value: unknown): string {
  const rank = normalizeEvaluationRank(value);
  if (rank === 'first') return '10%';
  if (rank === 'second') return '5%';
  return '';
}
