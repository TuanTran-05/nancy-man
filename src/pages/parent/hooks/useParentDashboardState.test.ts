import { describe, expect, it } from 'vitest';
import {
  buildUnavailableComparison,
  getDisplayedHomeworkScore,
  getEvaluationFinalScore10,
  getHomeworkScoreDisplayState,
} from './useParentDashboardState';

describe('useParentDashboardState truthful display helpers', () => {
  describe('getDisplayedHomeworkScore', () => {
    it('returns null for ungraded submissions', () => {
      expect(getDisplayedHomeworkScore(null)).toBeNull();
    });

    it('returns the numeric grade when present', () => {
      expect(getDisplayedHomeworkScore(8.5)).toBe(8.5);
      expect(getDisplayedHomeworkScore(0)).toBe(0);
    });
  });

  describe('getHomeworkScoreDisplayState', () => {
    it('keeps ungraded homework as null instead of coercing it to zero', () => {
      expect(getHomeworkScoreDisplayState(null)).toEqual({ score: null, isGraded: false });
    });

    it('returns a rounded numeric score for graded homework', () => {
      expect(getHomeworkScoreDisplayState(8.56)).toEqual({ score: 8.6, isGraded: true });
    });
  });

  describe('getEvaluationFinalScore10', () => {
    it('treats finalScore as a 100-point score before displaying it on a 10-point scale', () => {
      expect(getEvaluationFinalScore10({ finalScore: 10 } as any)).toBe(1);
      expect(getEvaluationFinalScore10({ finalScore: 85 } as any)).toBe(8.5);
    });

    it('falls back to the average evaluation score when finalScore is missing', () => {
      expect(
        getEvaluationFinalScore10({
          totalScore: 8,
          scores: {
            attendance: 80,
            effort: 90,
            pronunciation: 70,
            homework: 85,
            behavior: 95,
          },
        } as any)
      ).toBe(8.4);
    });

    it('returns 0 when no evaluation is available', () => {
      expect(getEvaluationFinalScore10(null)).toBe(0);
    });
  });

  describe('buildUnavailableComparison', () => {
    it('marks class comparison data unavailable when backend aggregates are absent', () => {
      expect(buildUnavailableComparison(8.2, 93)).toEqual({
        scoreStudent: 8.2,
        scoreClassAverage: null,
        attendanceStudent: 93,
        attendanceClassAverage: null,
        rankLabel: 'Chưa có dữ liệu',
      });
    });

    it('returns 0 for scoreStudent when finalScore10 is 0', () => {
      const result = buildUnavailableComparison(0, null);
      expect(result.scoreStudent).toBe(0);
      expect(result.attendanceStudent).toBe(0);
      expect(result.scoreClassAverage).toBeNull();
      expect(result.attendanceClassAverage).toBeNull();
      expect(result.rankLabel).toBe('Chưa có dữ liệu');
    });

    it('rounds scoreStudent to one decimal', () => {
      const result = buildUnavailableComparison(7.856, 88);
      expect(result.scoreStudent).toBe(7.9);
    });
  });
});
