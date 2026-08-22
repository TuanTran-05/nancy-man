import { materializeDocumentDateOnly } from './materializeDocumentDate.mjs';

const COURSE_CLOSING_DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value) {
  return String(value ?? '').trim();
}

function iso(value) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function normalizeProjectionSearchText(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function addDateOnlyDays(value, days) {
  const dateOnly = materializeDocumentDateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return '';
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function projectClassFinanceData(existing, terms) {
  const projectedTerms = (Array.isArray(existing?.terms) ? existing.terms : []).map((term) => {
    if (!term || typeof term !== 'object') return term;
    const source = terms.find((entry) => String(entry.id) === String(term.id));
    const tuitionFee = finiteNumber(source ? source.tuition_fee : term.tuitionFee);
    return {
      ...term,
      ...(tuitionFee === undefined ? { tuitionFee: null } : { tuitionFee }),
    };
  });
  const current = terms.at(-1);
  const currentTuitionFee = finiteNumber(current ? current.tuition_fee : existing?.tuitionFee);
  return {
    ...existing,
    ...(currentTuitionFee === undefined ? { tuitionFee: null } : { tuitionFee: currentTuitionFee }),
    terms: projectedTerms,
  };
}

export function projectCourseFeeLedger(existing, source, totals = {}) {
  const amount = finiteNumber(source.amount ?? existing?.amount);
  const paidTotal = finiteNumber(totals.paid_total ?? existing?.paidTotal) ?? 0;
  const discountTotal = finiteNumber(totals.discount_total ?? existing?.discountTotal) ?? 0;
  const siblingDiscountTotal =
    finiteNumber(totals.sibling_discount_total ?? existing?.siblingDiscountTotal) ?? 0;

  return {
    ...existing,
    termStart: materializeDocumentDateOnly(source.term_start ?? existing?.termStart),
    termEnd: materializeDocumentDateOnly(source.term_end ?? existing?.termEnd) || null,
    dueDate: materializeDocumentDateOnly(source.due_date ?? existing?.dueDate) || null,
    ...(amount === undefined ? {} : { amount }),
    paidTotal,
    discountTotal,
    siblingDiscountTotal,
  };
}

function classify(totalScore) {
  if (totalScore >= 90) return 'excellent';
  if (totalScore >= 80) return 'good';
  if (totalScore >= 70) return 'fair';
  if (totalScore >= 56) return 'average';
  return 'failing';
}

function availability(status, reason, assessedAt) {
  if (status !== 'verified' && status !== 'unavailable') return undefined;
  return {
    status,
    ...(reason ? { reason } : {}),
    ...(assessedAt ? { assessedAt: iso(assessedAt) } : {}),
  };
}

function projectedDocument(kind, row) {
  if (!row) {
    return {
      type: kind,
      status: 'not_requested',
      templateVersion: 1,
      mimeType: COURSE_CLOSING_DOCX_MIME,
      attempts: 0,
    };
  }
  const status = row.status === 'generating' ? 'retrying' : text(row.status) || 'pending';
  return {
    type: kind,
    status,
    templateVersion: finiteNumber(row.template_version) ?? 1,
    ...(row.storage_path ? { storagePath: row.storage_path } : {}),
    ...(row.preview_storage_path ? { previewStoragePath: row.preview_storage_path } : {}),
    ...(row.download_filename ? { downloadFilename: row.download_filename } : {}),
    mimeType: row.mime_type || COURSE_CLOSING_DOCX_MIME,
    ...(row.generated_at ? { generatedAt: iso(row.generated_at) } : {}),
    ...(row.source_notification_id ? { sourceNotificationId: row.source_notification_id } : {}),
    attempts: finiteNumber(row.attempts) ?? 0,
    ...(row.last_attempt_at ? { lastAttemptAt: iso(row.last_attempt_at) } : {}),
  };
}

function evaluationSnapshot(row) {
  if (!row.evaluation_id) return undefined;
  const totalScore = finiteNumber(row.evaluation_total_score);
  const finalExamScore = finiteNumber(row.evaluation_final_score);
  const scores = row.evaluation_scores_snapshot;
  if (
    totalScore === undefined ||
    finalExamScore === undefined ||
    !scores ||
    typeof scores !== 'object'
  ) {
    return undefined;
  }
  const numericScores = Object.fromEntries(
    ['attendance', 'effort', 'pronunciation', 'homework', 'behavior'].map((key) => [
      key,
      finiteNumber(scores[key]) ?? 0,
    ])
  );
  const classification = text(row.evaluation_classification) || classify(totalScore);
  return {
    evaluationId: row.evaluation_id,
    evaluationVersion: text(row.evaluation_version),
    evaluationDate: materializeDocumentDateOnly(row.evaluation_date_snapshot),
    scores: numericScores,
    finalExamScore,
    totalScore,
    classification,
    positivePoints: Array.isArray(row.evaluation_positive_points)
      ? row.evaluation_positive_points.map(text).filter(Boolean)
      : [],
    improvementPoints: text(row.evaluation_improvement_points),
    ...(row.evaluation_midterm_snapshot && typeof row.evaluation_midterm_snapshot === 'object'
      ? { midterm: row.evaluation_midterm_snapshot }
      : {}),
  };
}

function tuitionSnapshot(row) {
  const amount = finiteNumber(row.tuition_amount_snapshot);
  if (amount === undefined || !row.tuition_notice_date) return undefined;
  const noticeDate = materializeDocumentDateOnly(row.tuition_notice_date);
  const courseStartDate = materializeDocumentDateOnly(row.course_start_date);
  const courseEndDate = materializeDocumentDateOnly(row.course_end_date);
  const nextCourseStartDate = materializeDocumentDateOnly(row.next_course_start_date);
  const nextCourseEndDate = materializeDocumentDateOnly(row.next_course_end_date);
  return {
    noticeDate,
    amount,
    paymentWindowStart: noticeDate,
    paymentDueDate: addDateOnlyDays(nextCourseStartDate, 14),
    previousCourseStartDate: courseStartDate,
    previousCourseEndDate: courseEndDate,
    ...(row.tuition_final_exam_date
      ? { finalExamDate: materializeDocumentDateOnly(row.tuition_final_exam_date) }
      : {}),
    ...(finiteNumber(row.tuition_final_exam_score) === undefined
      ? {}
      : { finalExamScore: finiteNumber(row.tuition_final_exam_score) }),
    nextCourseStartDate,
    nextCourseEndDate,
    ...(row.tuition_ledger_id ? { ledgerId: row.tuition_ledger_id } : {}),
  };
}

export function projectCourseClosingRecord(row, documentRows = []) {
  const evaluation = evaluationSnapshot(row);
  const tuition = tuitionSnapshot(row);
  const evaluationDocument = documentRows.find((entry) => entry.kind === 'evaluation');
  const tuitionDocument = documentRows.find((entry) => entry.kind === 'tuition');
  const className = text(row.class_name_snapshot);
  const studentName = text(row.student_name_snapshot);
  const backfilledAt = iso(row.backfilled_at);

  return {
    id: text(row.id),
    recordVersion: finiteNumber(row.record_version) ?? 1,
    closingMonth: text(row.closing_month),
    courseId: text(row.course_id),
    classId: text(row.class_id),
    className,
    classNameNormalized: normalizeProjectionSearchText(className),
    courseStartDate: materializeDocumentDateOnly(row.course_start_date),
    courseEndDate: materializeDocumentDateOnly(row.course_end_date),
    studentId: text(row.student_id),
    studentName,
    studentNameNormalized: normalizeProjectionSearchText(studentName),
    studentCode: text(row.student_code_snapshot),
    teacherId: text(row.teacher_id),
    teacherName: text(row.teacher_name_snapshot),
    ...(evaluation ? { evaluationSnapshot: evaluation } : {}),
    ...(availability(
      row.evaluation_availability_status,
      row.evaluation_availability_reason,
      row.evaluation_availability_assessed_at
    )
      ? {
          evaluationDataAvailability: availability(
            row.evaluation_availability_status,
            row.evaluation_availability_reason,
            row.evaluation_availability_assessed_at
          ),
        }
      : {}),
    ...(tuition ? { tuitionSnapshot: tuition } : {}),
    ...(availability(
      row.tuition_availability_status,
      row.tuition_availability_reason,
      row.tuition_availability_assessed_at
    )
      ? {
          tuitionDataAvailability: availability(
            row.tuition_availability_status,
            row.tuition_availability_reason,
            row.tuition_availability_assessed_at
          ),
        }
      : {}),
    evaluationDocument: projectedDocument('evaluation', evaluationDocument),
    tuitionDocument: projectedDocument('tuition', tuitionDocument),
    ...(backfilledAt
      ? {
          backfill: {
            version: finiteNumber(row.backfill_version) ?? 1,
            backfilledAt,
            ...(row.backfill_source_digest ? { sourceDigest: row.backfill_source_digest } : {}),
          },
        }
      : {}),
    ...(row.repair_source ? { repairSource: row.repair_source } : {}),
    ...(row.repaired_at ? { repairedAt: iso(row.repaired_at) } : {}),
    createdAt: iso(row.created_at) || new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) || iso(row.created_at) || new Date(0).toISOString(),
  };
}
