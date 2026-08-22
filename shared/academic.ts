export type AcademicStudentLike = {
  id?: string;
  enrollmentStatus?: unknown;
  studentLifecycle?: unknown;
};

export type AcademicEvaluationLike = {
  evaluationType?: unknown;
  date?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AcademicCourseLike = {
  [key: string]: unknown;
  startDate?: unknown;
  endDate?: unknown;
  terms?: unknown;
};

export type AcademicCourseRecordLike = {
  [key: string]: unknown;
  date?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  type?: unknown;
  termId?: unknown;
  termStart?: unknown;
  termEnd?: unknown;
  courseEndDate?: unknown;
  nextCourseStartDate?: unknown;
  nextCourseEndDate?: unknown;
};

export function normalizeAcademicEnrollmentStatus(status: unknown): string {
  return String(status || 'active')
    .trim()
    .toLowerCase();
}

export function isCurrentAcademicStudent(student: AcademicStudentLike): boolean {
  if (String(student.studentLifecycle || '') === 'archived') return false;
  const status = normalizeAcademicEnrollmentStatus(student.enrollmentStatus);
  return status === 'active' || status === 'on_leave';
}

export function isRequiredAcademicEvaluationStudent(student: AcademicStudentLike): boolean {
  if (String(student.studentLifecycle || '') === 'archived') return false;
  return normalizeAcademicEnrollmentStatus(student.enrollmentStatus) === 'active';
}

export function isOfficeAcademicClassVisible(classData: unknown): boolean {
  const status = String((classData as { status?: unknown } | null | undefined)?.status || 'active')
    .trim()
    .toLowerCase();
  return status !== 'paused' && status !== 'archived';
}

function timeValue(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function evaluationSortValue(evaluation: AcademicEvaluationLike): number {
  return (
    timeValue(evaluation.date) || timeValue(evaluation.updatedAt) || timeValue(evaluation.createdAt)
  );
}

function hasArchivedCourseTerms(classData: AcademicCourseLike): boolean {
  return Array.isArray(classData.terms) && classData.terms.length > 0;
}

function textValue(value: unknown): string {
  return String(value || '').trim();
}

function dateTextValue(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
      value.getDate()
    ).padStart(2, '0')}`;
  }

  const raw = textValue(value);
  if (!raw) return '';

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;

  const vietnameseDate = raw.match(
    /^(?:\d{1,2}:\d{2}(?::\d{2})?\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );
  if (vietnameseDate) {
    const [, day, month, year] = vietnameseDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return raw;
}

function isTuitionNoticeType(type: unknown): boolean {
  return ['next_course_tuition', 'tuition_notice'].includes(textValue(type));
}

export function isCurrentAcademicCourseRecord(
  record: AcademicCourseRecordLike,
  classData: AcademicCourseLike
): boolean {
  const termId = textValue(record.termId);
  if (termId) return termId === 'current';

  const classStart = dateTextValue(classData.startDate);
  const classEnd = dateTextValue(classData.endDate);
  const termStart = dateTextValue(record.termStart);
  const termEnd = dateTextValue(record.termEnd);
  if (termStart || termEnd) {
    return termStart === classStart && (!classEnd || termEnd === classEnd);
  }

  const courseEndDate = dateTextValue(record.courseEndDate);
  if (courseEndDate) return !classEnd || courseEndDate === classEnd;

  if (isTuitionNoticeType(record.type)) {
    const nextCourseStart = dateTextValue(record.nextCourseStartDate);
    const nextCourseEnd = dateTextValue(record.nextCourseEndDate);
    if (nextCourseStart || nextCourseEnd) {
      return nextCourseStart === classStart && (!classEnd || nextCourseEnd === classEnd);
    }
    return hasArchivedCourseTerms(classData) ? false : true;
  }

  if (!hasArchivedCourseTerms(classData)) return true;

  const recordTime =
    timeValue(record.date) || timeValue(record.createdAt) || timeValue(record.updatedAt);
  const currentStartTime = timeValue(classData.startDate);
  if (!recordTime || !currentStartTime) return false;
  return recordTime >= currentStartTime;
}

export function selectFinalEvaluation<T extends AcademicEvaluationLike>(
  evaluations: T[]
): T | null {
  if (evaluations.length === 0) return null;
  const explicitFinal = evaluations.filter(
    (evaluation) => String(evaluation.evaluationType || '') === 'final'
  );
  const legacyWithoutType = evaluations.filter((evaluation) => !evaluation.evaluationType);
  const candidates = explicitFinal.length > 0 ? explicitFinal : legacyWithoutType;
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => evaluationSortValue(b) - evaluationSortValue(a))[0] || null;
}

export function selectMidtermEvaluation<T extends AcademicEvaluationLike>(
  evaluations: T[]
): T | null {
  if (evaluations.length === 0) return null;
  const explicitMidterm = evaluations.filter(
    (evaluation) => String(evaluation.evaluationType || '') === 'midterm'
  );
  if (explicitMidterm.length === 0) return null;
  return [...explicitMidterm].sort((a, b) => evaluationSortValue(b) - evaluationSortValue(a))[0] || null;
}

