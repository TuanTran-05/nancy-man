const REPAIR_SOURCE = 'manual_course_closing_course_reassignment' as const;

type Row = Record<string, any> & { id: string };

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function previousDay(value: Date): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() - 1);
  return result;
}

export function inferPreviousCourseRange(input: {
  currentStartDate: string;
  daysOfWeek: number[];
  holidays: string[];
  requiredSessions: number;
}) {
  if (!input.daysOfWeek.length || input.requiredSessions <= 0) {
    throw new Error('Previous course inference requires scheduled days and sessions.');
  }
  const scheduledDays = new Set(input.daysOfWeek);
  const holidays = new Set(input.holidays);
  let cursor = previousDay(parseDateOnly(input.currentStartDate));
  let sessions = 0;
  let endDate = '';
  let safety = 0;

  while (sessions < input.requiredSessions && safety < 730) {
    const candidate = dateOnly(cursor);
    if (scheduledDays.has(cursor.getUTCDay()) && !holidays.has(candidate)) {
      sessions += 1;
      if (!endDate) endDate = candidate;
      if (sessions === input.requiredSessions) {
        return { startDate: candidate, endDate };
      }
    }
    cursor = previousDay(cursor);
    safety += 1;
  }
  throw new Error('Unable to infer the previous course range.');
}

export function buildSuperkidsCourseClosingRepairPlan(input: {
  classData: Record<string, any>;
  newCourseId: string;
  now: string;
  correctedNoticeDate: string;
  correctedPaymentDueDate: string;
  evaluations: Row[];
  records: Row[];
  notifications: Row[];
  ledgers: Row[];
}) {
  const currentStartDate = String(input.classData.startDate || '');
  const currentEndDate = String(input.classData.endDate || '');
  const oldCourseId = String(input.classData.currentCourseId || '');
  const closing = input.classData.courseClosing || {};
  if (!oldCourseId || !input.newCourseId || oldCourseId === input.newCourseId) {
    throw new Error('Repair requires distinct old and new course IDs.');
  }
  if (
    String(closing.courseId || '') !== oldCourseId ||
    String(closing.termStart || '') !== currentStartDate ||
    String(closing.termEnd || '') !== currentEndDate
  ) {
    throw new Error('Class course-closing state no longer matches the mistaken current course.');
  }
  if (!input.evaluations.length) throw new Error('No evaluations found to reassign.');
  const unexpectedEvaluation = input.evaluations.find(
    (row) =>
      row.evaluationType !== 'final' ||
      row.termId !== 'current' ||
      row.termStart !== currentStartDate ||
      row.termEnd !== currentEndDate
  );
  if (unexpectedEvaluation) {
    throw new Error('Unexpected evaluation outside the mistaken current-course finals.');
  }
  if (
    input.records.some(
      (row) =>
        row.courseId !== oldCourseId ||
        row.courseStartDate !== currentStartDate ||
        row.courseEndDate !== currentEndDate
    )
  ) {
    throw new Error('Unexpected course-closing record identity or date range.');
  }
  if (input.notifications.some((row) => row.courseId !== oldCourseId)) {
    throw new Error('Unexpected notification course identity.');
  }
  if (
    input.ledgers.some(
      (row) => row.termStart !== currentStartDate || row.termEnd !== currentEndDate
    )
  ) {
    throw new Error('Unexpected ledger outside the current course.');
  }

  const previousRange = inferPreviousCourseRange({
    currentStartDate,
    daysOfWeek: input.classData.daysOfWeek || [],
    holidays: input.classData.holidays || [],
    requiredSessions: 16,
  });
  const termId = `term_repair_${oldCourseId}`;
  const existingTerms = Array.isArray(input.classData.terms) ? input.classData.terms : [];
  if (existingTerms.some((term: any) => term?.id === termId || term?.courseId === oldCourseId)) {
    throw new Error('The outgoing course is already archived.');
  }
  const previousCourse = {
    id: termId,
    name: `Khoa ${previousRange.startDate} - ${previousRange.endDate}`,
    startDate: previousRange.startDate,
    endDate: previousRange.endDate,
    holidays: input.classData.holidays || [],
    weeklySessions: input.classData.weeklySessions || [],
    daysOfWeek: input.classData.daysOfWeek || [],
    courseId: oldCourseId,
    courseClosing: {
      ...closing,
      courseId: oldCourseId,
      termStart: previousRange.startDate,
      termEnd: previousRange.endDate,
    },
    repairSource: REPAIR_SOURCE,
  };

  return {
    previousCourse,
    classUpdate: {
      currentCourseId: input.newCourseId,
      terms: [...existingTerms, previousCourse],
      deleteCourseClosing: true,
      updatedAt: input.now,
    },
    evaluationUpdates: input.evaluations.map((row) => ({
      id: row.id,
      termId,
      termStart: previousRange.startDate,
      termEnd: previousRange.endDate,
      repairSource: REPAIR_SOURCE,
      repairedAt: input.now,
    })),
    recordUpdates: input.records.map((row) => ({
      id: row.id,
      closingMonth: previousRange.endDate.slice(0, 7),
      courseStartDate: previousRange.startDate,
      courseEndDate: previousRange.endDate,
      ...(row.tuitionSnapshot
        ? {
            tuitionSnapshot: {
              ...row.tuitionSnapshot,
              noticeDate: input.correctedNoticeDate,
              paymentWindowStart: input.correctedNoticeDate,
              paymentDueDate: input.correctedPaymentDueDate,
              previousCourseStartDate: previousRange.startDate,
              previousCourseEndDate: previousRange.endDate,
              nextCourseStartDate: currentStartDate,
              nextCourseEndDate: currentEndDate,
            },
          }
        : {}),
      repairSource: REPAIR_SOURCE,
      repairedAt: input.now,
      updatedAt: input.now,
    })),
    notificationAnnotations: input.notifications.map((row) => ({
      id: row.id,
      reassignedTermId: termId,
      reassignedCourseStartDate: previousRange.startDate,
      reassignedCourseEndDate: previousRange.endDate,
      repairSource: REPAIR_SOURCE,
      repairedAt: input.now,
    })),
    ledgerIdsToClearClosingNotice: input.ledgers.map((row) => row.id),
  };
}
