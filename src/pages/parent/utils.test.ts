import { describe, expect, it } from 'vitest';
import {
  buildRadarComparisonData,
  buildRadarMetrics,
  buildTermTrendData,
  buildTimelineItems,
  formatAverageScore,
  getAverageScore100,
  getInitials,
  getLevelLabel,
} from './utils';

describe('parent dashboard utilities', () => {
  describe('getAverageScore100', () => {
    it('returns null when evaluation is null or undefined', () => {
      expect(getAverageScore100(null)).toBeNull();
      expect(getAverageScore100(undefined)).toBeNull();
    });

    it('returns null when an evaluation has no totalScore and no scores object', () => {
      expect(getAverageScore100({ id: 'eval-1' } as any)).toBeNull();
    });

    it('returns totalScore when present', () => {
      expect(
        getAverageScore100({
          totalScore: 85,
          scores: { attendance: 80, effort: 90, pronunciation: 70, homework: 85, behavior: 95 },
        } as any)
      ).toBe(85);
    });

    it('averages component scores when scores are present but no totalScore', () => {
      expect(
        getAverageScore100({
          scores: {
            attendance: 80,
            effort: 90,
            pronunciation: 70,
            homework: 85,
            behavior: 95,
          },
        } as any)
      ).toBe(84);
    });

    it('returns null when totalScore is not a number and scores is missing', () => {
      expect(getAverageScore100({ totalScore: undefined } as any)).toBeNull();
    });

    it('prefers 100-point component scores when totalScore looks like a legacy 10-point value', () => {
      expect(
        getAverageScore100({
          totalScore: 8,
          scores: {
            attendance: 80,
            effort: 90,
            pronunciation: 70,
            homework: 85,
            behavior: 95,
          },
        } as any)
      ).toBe(84);
    });
  });

  describe('formatAverageScore', () => {
    it('returns -- for null', () => {
      expect(formatAverageScore(null)).toBe('--');
    });

    it('formats score divided by 10 with one decimal', () => {
      expect(formatAverageScore(85)).toBe('8.5');
      expect(formatAverageScore(100)).toBe('10.0');
    });
  });

  describe('getInitials', () => {
    it('returns PH for empty/null names', () => {
      expect(getInitials(null)).toBe('PH');
      expect(getInitials(undefined)).toBe('PH');
      expect(getInitials('')).toBe('PH');
    });

    it('returns first two letters for single-word names', () => {
      expect(getInitials('An')).toBe('AN');
    });

    it('returns first and last initials for multi-word names', () => {
      expect(getInitials('Nguyen Van An')).toBe('NA');
    });
  });

  describe('getLevelLabel', () => {
    it('extracts level from class name if present', () => {
      expect(getLevelLabel('Class A2 - Morning', 50)).toBe('A2');
      expect(getLevelLabel('B1 Advanced', 50)).toBe('B1');
    });

    it('returns Starter for null score with no level in class name', () => {
      expect(getLevelLabel('Class Alpha', null)).toBe('Starter');
    });

    it('maps score ranges to levels', () => {
      expect(getLevelLabel('Class Alpha', 95)).toBe('B2');
      expect(getLevelLabel('Class Alpha', 85)).toBe('B1');
      expect(getLevelLabel('Class Alpha', 75)).toBe('A2');
      expect(getLevelLabel('Class Alpha', 60)).toBe('A1');
    });
  });

  describe('buildRadarMetrics', () => {
    it('returns no radar metrics when the latest evaluation has no component scores', () => {
      expect(buildRadarMetrics({ score: 8 } as any)).toEqual([]);
    });

    it('returns only real component scores from the latest evaluation', () => {
      expect(
        buildRadarMetrics({
          scores: { attendance: 90, homework: 80, participation: null },
        } as any)
      ).toEqual([
        { skill: 'Chuyên cần', value: 90, target: 85 },
        { skill: 'Bài tập', value: 80, target: 85 },
      ]);
    });

    it('treats persisted component score 10 as 10 percent, not a 10-point perfect score', () => {
      const result = buildRadarMetrics({
        scores: { attendance: 10 },
      } as any);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ value: 10, target: 85 });
    });

    it('does not fabricate missing previous radar values from the target', () => {
      const result = buildRadarComparisonData(
        {
          scores: { attendance: 80, homework: 70 },
        } as any,
        {
          scores: { homework: 60 },
        } as any
      );

      expect(result).toEqual([
        { skill: 'Chuyên cần', current: 80, previous: null },
        { skill: 'Bài tập', current: 70, previous: 60 },
      ]);
    });
  });

  describe('buildTermTrendData', () => {
    it('does not fabricate a start point for a single evaluation', () => {
      const result = buildTermTrendData([{ date: '2026-01-10', score: 80 } as any]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ label: '10/01', average: 80, isActual: true });
    });

    it('uses the visible fallback term label in the tooltip when term name is empty', () => {
      const result = buildTermTrendData(
        [{ date: '2026-01-10', totalScore: 80 } as any],
        [{ id: 'term-1', name: '', startDate: '2026-01-01', endDate: '2026-01-31' } as any]
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        label: 'Khóa học trước',
        tooltipLabel: 'Khóa học trước (01/2026)',
      });
    });

    it('assigns an evaluation to only one adjacent term', () => {
      const result = buildTermTrendData([{ date: '2026-04-05', totalScore: 80 } as any], [
        { id: 'term-1', name: 'Term 1', startDate: '2026-03-01', endDate: '2026-03-31' },
        { id: 'term-2', name: 'Term 2', startDate: '2026-04-01', endDate: '2026-04-30' },
      ] as any);

      expect(result).toEqual([
        { label: 'Term 2', tooltipLabel: 'Term 2 (04/2026)', average: 80, isActual: true },
      ]);
    });

    it('keeps raw 100-point average precision so the hook rounds only once', () => {
      const evaluations = [
        ...Array.from({ length: 10 }, (_, index) => ({
          date: `2026-01-${String(index + 1).padStart(2, '0')}`,
          totalScore: 70,
        })),
        { date: '2026-01-11', totalScore: 76 },
      ] as any[];

      const result = buildTermTrendData(evaluations, [
        { id: 'term-1', name: 'Term 1', startDate: '2026-01-01', endDate: '2026-01-31' },
      ] as any);

      expect(result[0].average).toBeCloseTo(70.545, 3);
      expect(Number((result[0].average / 10).toFixed(1))).toBe(7.1);
    });
  });

  describe('buildTimelineItems', () => {
    it('returns an empty timeline when there are no terms or evaluations', () => {
      expect(buildTimelineItems([], [])).toEqual([]);
    });
  });
});
