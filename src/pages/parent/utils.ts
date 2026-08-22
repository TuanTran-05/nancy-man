import { endOfDay, format, startOfDay } from 'date-fns';
import type { Locale } from 'date-fns';
import type { Attendance, ClassTerm, Evaluation } from '../../types';

export const DONUT_COLORS = ['#10B981', '#F97316', '#EF4444'];

const SCORE_KEYS = [
  'attendance',
  'homework',
  'effort',
  'pronunciation',
  'behavior',
] as const satisfies readonly (keyof Evaluation['scores'])[];

type ScoreKey = (typeof SCORE_KEYS)[number];

const SCORE_LABELS: Record<ScoreKey, string> = {
  attendance: 'Chuyên cần',
  homework: 'Bài tập',
  effort: 'Nỗ lực',
  pronunciation: 'Phát âm',
  behavior: 'Thái độ',
};

const RADAR_TARGET = 85;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeScore100(value: number) {
  return Math.round(clamp(value, 0, 100));
}

function componentAverageScore100(evaluation?: Partial<Evaluation> | null) {
  const scores = evaluation?.scores as Record<string, unknown> | undefined;
  if (!scores || typeof scores !== 'object') return null;

  const values = SCORE_KEYS.map((key) => finiteNumber(scores[key]))
    .filter((value): value is number => value !== null)
    .map(normalizeScore100);

  return values.length ? average(values) : null;
}

function evaluationScore100(evaluation?: (Partial<Evaluation> & { score?: number }) | null) {
  if (!evaluation) return null;

  const explicitScore = finiteNumber(evaluation.score);
  if (explicitScore !== null) return normalizeScore100(explicitScore);

  const componentAverage = componentAverageScore100(evaluation);
  const totalScore = finiteNumber(evaluation.totalScore);
  if (totalScore !== null) {
    if (totalScore <= 10 && componentAverage !== null && componentAverage > 10) {
      return componentAverage;
    }
    return normalizeScore100(totalScore);
  }

  const finalScore = finiteNumber(evaluation.finalScore);
  if (finalScore !== null) return normalizeScore100(finalScore);

  return componentAverage;
}

export function getAverageScore100(evaluation?: Evaluation | null) {
  if (!evaluation) return null;

  const componentAverage = componentAverageScore100(evaluation);
  const totalScore = finiteNumber(evaluation.totalScore);
  if (totalScore !== null) {
    if (totalScore <= 10 && componentAverage !== null && componentAverage > 10) {
      return componentAverage;
    }
    return normalizeScore100(totalScore);
  }

  return componentAverage;
}

export function formatAverageScore(score100: number | null) {
  if (score100 === null) return '--';
  return (score100 / 10).toFixed(1);
}

export function getInitials(name?: string | null) {
  if (!name) return 'PH';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function getSafeDate(value?: string | number | Date | null) {
  const date = value instanceof Date ? value : new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildRadarMetrics(evaluation?: Evaluation | null) {
  const scores = evaluation?.scores as Record<string, unknown> | undefined;
  if (!scores || typeof scores !== 'object') return [];

  return SCORE_KEYS.map((key) => [key, SCORE_LABELS[key]] as const).flatMap(([key, skill]) => {
    const score = finiteNumber(scores[key]);
    if (score === null) return [];
    return {
      skill,
      value: normalizeScore100(score),
      target: RADAR_TARGET,
    };
  });
}

export type RadarComparisonDatum = {
  skill: string;
  current: number;
  previous: number | null;
};

export function buildRadarComparisonData(
  latestEval?: Evaluation | null,
  previousEval?: Evaluation | null
): RadarComparisonDatum[] {
  const previousBySkill = new Map(
    buildRadarMetrics(previousEval).map((metric) => [metric.skill, metric.value])
  );

  return buildRadarMetrics(latestEval).map((metric) => ({
    skill: metric.skill,
    current: metric.value,
    previous: previousBySkill.get(metric.skill) ?? null,
  }));
}

export type TermTrendPoint = {
  label: string;
  average: number;
  isActual: boolean;
  tooltipLabel?: string;
};

export function buildTermTrendData(
  evaluations: Array<Partial<Evaluation> & { score?: number }>,
  terms: ClassTerm[] = [],
  locale?: Locale
): TermTrendPoint[] {
  if (terms.length > 0) {
    return [...terms]
      .sort((left, right) => {
        const leftDate = getSafeDate(left.startDate)?.getTime() ?? 0;
        const rightDate = getSafeDate(right.startDate)?.getTime() ?? 0;
        return leftDate - rightDate;
      })
      .flatMap((term) => {
        const termStart = getSafeDate(term.startDate);
        const termEnd = getSafeDate(term.endDate);
        if (!termStart || !termEnd) return [];

        const startBound = startOfDay(termStart).getTime();
        const endBound = endOfDay(termEnd).getTime();
        const termScores = evaluations
          .filter((evaluation) => {
            const date = getSafeDate(evaluation.date);
            if (!date) return false;
            const time = date.getTime();
            return time >= startBound && time <= endBound;
          })
          .map(evaluationScore100)
          .filter((score): score is number => score !== null);

        if (!termScores.length) return [];

        const termLabel = term.name || 'Khóa học trước';

        return {
          label: termLabel,
          tooltipLabel: `${termLabel} (${format(termEnd, 'MM/yyyy')})`,
          average: average(termScores),
          isActual: true,
        };
      });
  }

  return [...evaluations]
    .sort((left, right) => {
      const leftDate = getSafeDate(left.date)?.getTime() ?? 0;
      const rightDate = getSafeDate(right.date)?.getTime() ?? 0;
      return leftDate - rightDate;
    })
    .flatMap((evaluation) => {
      const date = getSafeDate(evaluation.date);
      const score = evaluationScore100(evaluation);
      if (!date || score === null) return [];
      return {
        label: format(date, 'dd/MM', { locale }),
        tooltipLabel: format(date, 'dd/MM/yyyy', { locale }),
        average: score,
        isActual: true,
      };
    });
}

export type TimelineItem = {
  id: string;
  name: string;
  dateLabel: string;
  badge: string;
  active: boolean;
};

export function buildTimelineItems(
  terms: ClassTerm[],
  evaluations: Evaluation[],
  options: {
    currentClass?: { id: string; name: string; startDate: string; endDate: string } | null;
    selectedTerm?: string;
    formatDateLabel?: (value?: string | number | Date | null) => string;
  } = {}
): TimelineItem[] {
  const formatDateLabel =
    options.formatDateLabel ??
    ((value?: string | number | Date | null) => {
      const date = getSafeDate(value);
      return date ? format(date, 'dd/MM/yyyy') : '--';
    });
  const currentItem = options.currentClass ? [options.currentClass] : [];
  const combinedTerms = [...terms, ...currentItem].sort((left, right) => {
    const leftTime = getSafeDate(left.startDate)?.getTime() ?? 0;
    const rightTime = getSafeDate(right.startDate)?.getTime() ?? 0;
    return leftTime - rightTime;
  });

  return combinedTerms.map((term, index, array) => {
    const termStart = getSafeDate(term.startDate);
    const termEnd = getSafeDate(term.endDate);
    const latestTermEval = [...evaluations]
      .filter((evaluation) => {
        const date = getSafeDate(evaluation.date);
        if (!date || !termStart || !termEnd) return false;
        return date >= termStart && date <= termEnd;
      })
      .sort((left, right) => {
        const leftTime = getSafeDate(left.date)?.getTime() ?? 0;
        const rightTime = getSafeDate(right.date)?.getTime() ?? 0;
        return rightTime - leftTime;
      })[0];

    return {
      id: term.id,
      name: term.name,
      dateLabel: `${formatDateLabel(term.startDate)} - ${formatDateLabel(term.endDate)}`,
      badge:
        latestTermEval?.positivePoints?.[0] ||
        latestTermEval?.aiFeedback?.split(/[.!?]/)[0] ||
        (index === array.length - 1 ? 'Đang theo dõi' : 'Giữ vững phong độ'),
      active:
        options.selectedTerm === term.id ||
        (options.selectedTerm === 'current' && term.id === 'current'),
    };
  });
}

export function getLevelLabel(className: string | undefined, score100: number | null) {
  const match = className?.match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
  if (match) return match[1].toUpperCase();
  if (score100 === null) return 'Starter';
  if (score100 >= 90) return 'B2';
  if (score100 >= 82) return 'B1';
  if (score100 >= 72) return 'A2';
  return 'A1';
}

export function getStatusText(
  status: Attendance['status'] | 'empty',
  noDataLabel: string,
  presentLabel: string,
  lateLabel: string,
  absentLabel: string
) {
  if (status === 'present') return presentLabel;
  if (status === 'late') return lateLabel;
  if (status === 'absent') return absentLabel;
  return noDataLabel;
}
