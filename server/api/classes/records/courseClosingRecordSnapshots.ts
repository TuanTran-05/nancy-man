import {
  classifyCourseResult,
  type CourseClosingEvaluationSnapshot,
  type CourseClosingTuitionSnapshot,
} from '../../../../shared/courseClosingRecords.js';
import { getNextCourseTuitionSchedule } from '../../zalo/helpers/tuitionDates.js';
import {
  normalizeArchiveDateOnly,
  type ArchiveMidtermSource,
} from './courseClosingRecordSources.js';

function scoreValue(value: unknown, field: string): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${field} is required`);
  }
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`${field} must be between 0 and 100, got ${score}`);
  }
  return score;
}

export function buildEvaluationArchiveSnapshot(input: {
  finalEvaluation: Record<string, unknown>;
  evaluationVersion: string;
  midtermEvaluation?: ArchiveMidtermSource;
}): CourseClosingEvaluationSnapshot {
  const evalData = input.finalEvaluation;
  const evaluationId = String(evalData.id || '');
  const evaluationVersion = input.evaluationVersion;
  const evaluationDate = normalizeArchiveDateOnly(evalData.date, 'evaluationDate');

  const scoresInput = (evalData.scores as Record<string, unknown>) || {};
  const scores = {
    attendance: scoreValue(scoresInput.attendance, 'attendance'),
    effort: scoreValue(scoresInput.effort, 'effort'),
    pronunciation: scoreValue(scoresInput.pronunciation, 'pronunciation'),
    homework: scoreValue(scoresInput.homework, 'homework'),
    behavior: scoreValue(scoresInput.behavior, 'behavior'),
  };

  const finalScoreRaw = evalData.finalScore ?? evalData.totalScore;
  const finalExamScore = scoreValue(finalScoreRaw, 'finalExamScore');
  const totalScore = scoreValue(evalData.totalScore, 'totalScore');

  const classification = classifyCourseResult(totalScore);

  const positivePoints = Array.isArray(evalData.positivePoints)
    ? evalData.positivePoints.map((p) => String(p).trim()).filter(Boolean)
    : [];
  const improvementPoints = String(evalData.improvementPoints || '').trim();

  let midterm: CourseClosingEvaluationSnapshot['midterm'] | undefined;
  if (input.midtermEvaluation) {
    const mData = input.midtermEvaluation.data;
    try {
      midterm = {
        evaluationId: input.midtermEvaluation.evaluationId,
        evaluationDate: normalizeArchiveDateOnly(mData.date, 'midtermEvaluationDate'),
        examScore: scoreValue(mData.finalScore ?? mData.totalScore, 'midtermExamScore'),
      };
    } catch {
      midterm = undefined;
    }
  }

  return {
    evaluationId,
    evaluationVersion,
    evaluationDate,
    scores,
    finalExamScore,
    totalScore,
    classification,
    positivePoints,
    improvementPoints,
    ...(midterm ? { midterm } : {}),
  };
}

export function buildTuitionArchiveSnapshot(input: {
  noticeDate: string;
  tuitionAmount: number;
  paymentDueDate: string;
  courseStartDate: string;
  courseEndDate: string;
  finalExamDate?: string;
  finalExamScore?: number;
  classData: Record<string, unknown>;
  ledgerId?: string;
  schedule?: {
    previousEndDate: string;
    startDate: string;
    endDate: string;
    dueDate: string;
  };
}): CourseClosingTuitionSnapshot {
  const noticeDate = normalizeArchiveDateOnly(input.noticeDate, 'noticeDate');
  const amount = Number(input.tuitionAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`tuitionAmount must be non-negative, got ${amount}`);
  }

  const paymentWindowStart = noticeDate;
  const paymentDueDate = normalizeArchiveDateOnly(input.paymentDueDate, 'paymentDueDate');
  const previousCourseStartDate = normalizeArchiveDateOnly(
    input.courseStartDate,
    'previousCourseStartDate'
  );
  const previousCourseEndDate = normalizeArchiveDateOnly(
    input.courseEndDate,
    'previousCourseEndDate'
  );
  const finalExamDate = input.finalExamDate
    ? normalizeArchiveDateOnly(input.finalExamDate, 'finalExamDate')
    : undefined;
  const finalExamScore =
    input.finalExamScore === undefined ? undefined : Number(input.finalExamScore);
  if (
    finalExamScore !== undefined &&
    (!Number.isFinite(finalExamScore) || finalExamScore < 0 || finalExamScore > 100)
  ) {
    throw new Error(`finalExamScore must be between 0 and 100, got ${finalExamScore}`);
  }

  const sched =
    input.schedule || getNextCourseTuitionSchedule(input.courseEndDate, input.classData);

  const nextCourseStartDate = normalizeArchiveDateOnly(sched.startDate, 'nextCourseStartDate');
  const nextCourseEndDate = normalizeArchiveDateOnly(sched.endDate, 'nextCourseEndDate');

  return {
    noticeDate,
    amount,
    paymentWindowStart,
    paymentDueDate,
    previousCourseStartDate,
    previousCourseEndDate,
    ...(finalExamDate ? { finalExamDate } : {}),
    ...(finalExamScore !== undefined ? { finalExamScore } : {}),
    nextCourseStartDate,
    nextCourseEndDate,
    ...(input.ledgerId ? { ledgerId: input.ledgerId } : {}),
  };
}
