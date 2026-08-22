export const COURSE_CLOSING_RECORD_VERSION = 1 as const;
export const COURSE_CLOSING_TEMPLATE_VERSION = 1 as const;
export const COURSE_CLOSING_DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

export type ClosingDocumentType = 'evaluation' | 'tuition';
export type ClosingDocumentStatus = 'not_requested' | 'pending' | 'ready' | 'retrying' | 'failed';
export type CourseClosingDataAvailabilityStatus = 'verified' | 'unavailable';
export type CourseClosingDataUnavailableReason =
  | 'historical_source_missing'
  | 'historical_source_incomplete';
export type CourseResultClassification = 'excellent' | 'good' | 'fair' | 'average' | 'failing';
export type CourseClosingRecordDisplayStatus =
  | 'complete'
  | 'missing_evaluation'
  | 'missing_tuition'
  | 'pending'
  | 'not_requested'
  | 'retrying'
  | 'failed';
export type CourseClosingTuitionDisplayStatus =
  | 'not_requested'
  | 'pending'
  | 'ready'
  | 'retrying'
  | 'failed';

export interface ClosingStoredDocument {
  type: ClosingDocumentType;
  status: ClosingDocumentStatus;
  templateVersion: 1;
  storagePath?: string;
  /** @deprecated Legacy HTML preview location; new previews render storagePath directly. */
  previewStoragePath?: string;
  downloadFilename?: string;
  mimeType: typeof COURSE_CLOSING_DOCX_MIME;
  generatedAt?: string;
  sourceNotificationId?: string;
  attempts: number;
  lastAttemptAt?: string;
  lastErrorCode?: string;
}

export interface CourseClosingDataAvailability {
  status: CourseClosingDataAvailabilityStatus;
  reason?: CourseClosingDataUnavailableReason;
  assessedAt?: string;
}

export interface CourseClosingEvaluationSnapshot {
  evaluationId: string;
  evaluationVersion: string;
  evaluationDate: string;
  scores: {
    attendance: number;
    effort: number;
    pronunciation: number;
    homework: number;
    behavior: number;
  };
  finalExamScore: number;
  totalScore: number;
  classification: CourseResultClassification;
  positivePoints: string[];
  improvementPoints: string;
  midterm?: {
    evaluationId: string;
    evaluationDate: string;
    examScore: number;
  };
}

export interface CourseClosingTuitionSnapshot {
  noticeDate: string;
  amount: number;
  paymentWindowStart: string;
  paymentDueDate: string;
  previousCourseStartDate: string;
  previousCourseEndDate: string;
  finalExamDate?: string;
  finalExamScore?: number;
  nextCourseStartDate: string;
  nextCourseEndDate: string;
  ledgerId?: string;
}

export interface CourseClosingRecord {
  id: string;
  recordVersion: 1;
  closingMonth: string;
  courseId: string;
  classId: string;
  className: string;
  classNameNormalized: string;
  courseStartDate: string;
  courseEndDate: string;
  studentId: string;
  studentName: string;
  studentNameNormalized: string;
  studentCode: string;
  teacherId: string;
  teacherName: string;
  evaluationSnapshot?: CourseClosingEvaluationSnapshot;
  evaluationDataAvailability?: CourseClosingDataAvailability;
  tuitionSnapshot?: CourseClosingTuitionSnapshot;
  tuitionDataAvailability?: CourseClosingDataAvailability;
  evaluationDocument: ClosingStoredDocument;
  tuitionDocument: ClosingStoredDocument;
  backfill?: {
    version: 1;
    backfilledAt: string;
    sourceDigest?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export function deriveCourseClosingDataAvailability(
  snapshot: unknown,
  availability?: CourseClosingDataAvailability
): CourseClosingDataAvailabilityStatus | undefined {
  if (snapshot) return 'verified';
  return availability?.status;
}

export function normalizeSearchText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function courseClosingRecordId(courseId: string, studentId: string): string {
  return `${courseId}__${studentId}`;
}

export function closingMonthFromCourseEnd(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Course end date must use YYYY-MM-DD');
  }
  return value.slice(0, 7);
}

export function classifyCourseResult(score: number): CourseResultClassification {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Course result score must be between 0 and 100');
  }
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'fair';
  if (score >= 56) return 'average';
  return 'failing';
}

export function courseClosingStoragePath(input: {
  closingMonth: string;
  classId: string;
  courseId: string;
  studentId: string;
  documentType: ClosingDocumentType;
  templateVersion: number;
}): string {
  return `course_closing_records/${input.closingMonth}/${input.classId}/${input.courseId}/${input.studentId}/${input.documentType}-v${input.templateVersion}.docx`;
}

export function courseClosingDownloadFilename(
  studentName: string,
  documentType: ClosingDocumentType
): string {
  const normalizedName = normalizeSearchText(studentName)
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_');
  const typeSuffix = documentType === 'evaluation' ? 'Nhan_xet_ket_khoa' : 'Thong_bao_hoc_phi';
  return `${normalizedName}_${typeSuffix}.docx`;
}

export function deriveCourseClosingRecordStatus(
  record: Pick<CourseClosingRecord, 'evaluationDocument' | 'tuitionDocument'>
): CourseClosingRecordDisplayStatus {
  const evalStatus = record.evaluationDocument.status;
  const tuitionStatus = record.tuitionDocument.status;

  if (evalStatus === 'retrying' || tuitionStatus === 'retrying') {
    return 'retrying';
  }
  if (evalStatus === 'failed' || tuitionStatus === 'failed') {
    return 'failed';
  }
  if (evalStatus === 'ready' && tuitionStatus === 'ready') {
    return 'complete';
  }
  if (evalStatus === 'ready' && tuitionStatus !== 'ready') {
    return 'missing_tuition';
  }
  if (evalStatus !== 'ready' && tuitionStatus === 'ready') {
    return 'missing_evaluation';
  }
  if (evalStatus === 'pending' || tuitionStatus === 'pending') {
    return 'pending';
  }
  return 'not_requested';
}

export function deriveTuitionArchiveStatus(
  document: Pick<ClosingStoredDocument, 'status'>
): CourseClosingTuitionDisplayStatus {
  return document.status;
}
