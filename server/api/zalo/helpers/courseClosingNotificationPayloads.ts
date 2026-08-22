import { withStatus } from '../../lib/http/helpers.js';
import type { CourseClosingSendContext } from '../../classes/helpers/courseClosing.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';
import {
  getEvaluationRankDiscount,
  getEvaluationRankTemplateLabel,
  normalizeEvaluationRank,
} from '../../../../shared/evaluationRank.js';
import { limitTextLength, parseNumberParam } from './zaloBaseHelpers.js';

const EVALUATION_COMMENT_LIMIT = 200;

function canonicalPositivePoints(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join('; ');
  return String(value || '');
}

export function recipientFromCourseClosingContext(
  context: CourseClosingSendContext,
  actorUid: string
) {
  const phone = normalizePhoneVN(String(context.studentData.contact || ''));
  if (!phone) throw withStatus('Student contact is missing', 400);
  return {
    studentId: String(context.studentData.id || context.studentData.studentId || ''),
    studentName: String(context.studentData.name || ''),
    studentCode: String(context.studentData.code || context.studentData.studentId || ''),
    classId: String(context.finalEvaluationData.classId || ''),
    className: String(context.classData.name || ''),
    teacherId: String(context.classData.teacherId || context.studentData.teacherId || actorUid),
    phone,
    classData: context.classData,
  };
}

export function buildCanonicalEvaluationNotification(context: CourseClosingSendContext) {
  const data = context.finalEvaluationData;
  const finalGrade = data.finalScore ?? data.totalScore;
  if (finalGrade === undefined || finalGrade === null || String(finalGrade) === '') {
    throw withStatus('Current final evaluation has no final grade', 409);
  }
  return {
    finalGrade: String(finalGrade),
    good:
      limitTextLength(canonicalPositivePoints(data.positivePoints), EVALUATION_COMMENT_LIMIT) ||
      'Chưa có nhận xét',
    bad:
      limitTextLength(String(data.improvementPoints || ''), EVALUATION_COMMENT_LIMIT) || 'Không có',
    courseEndDate: String(context.classData.endDate || ''),
  };
}

export function buildCanonicalRankNotification(context: CourseClosingSendContext) {
  const rank = normalizeEvaluationRank(context.finalEvaluationData.rank);
  return {
    rank,
    rankLabel: getEvaluationRankTemplateLabel(rank),
    discount: getEvaluationRankDiscount(rank),
    courseEndDate: String(context.classData.endDate || ''),
  };
}

export function buildCanonicalTuitionNoticeBody(
  context: CourseClosingSendContext,
  ledger?: Record<string, unknown>
): Record<string, unknown> {
  const amount = parseNumberParam(ledger?.amount ?? context.classData.tuitionFee);
  if (amount <= 0) throw withStatus('Canonical tuition fee is missing', 400);
  const dueDate = String(ledger?.paymentDueDate || ledger?.tuitionDueDate || ledger?.dueDate || '');
  return {
    schoolFee: amount,
    ...(dueDate ? { paymentDueDate: dueDate } : {}),
  };
}
