/**
 * Domain module: reconstructs a student's enrollment timeline.
 * Pure functions — no DocumentStore, no side-effects.
 *
 * A student document stores only its current classId, so the history of
 * classes and courses ("khóa") is inferred from evidence: attendance rows
 * and fee ledgers, joined against each class's course intervals.
 */

export type TermKey = string;

export const CURRENT_TERM_ID = 'current';
export const UNKNOWN_TERM_ID = 'unknown';

export type AttendanceMode = 'expected' | 'marked_only';

export type TermSchedule = {
  holidays: string[];
  weeklySessions: unknown[];
  daysOfWeek: number[];
};

export type ClassTerm = {
  termId: string;
  classId: string;
  /** 1-based ordinal within the class — rendered as "Khóa 1", "Khóa 2". */
  index: number;
  startDate: string;
  /** '' means open-ended. */
  endDate: string;
  isCurrent: boolean;
  /** null when the course predates schedule snapshotting. */
  schedule: TermSchedule | null;
};

export type ClassLike = {
  id: string;
  name?: unknown;
  grade?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  holidays?: unknown;
  weeklySessions?: unknown;
  daysOfWeek?: unknown;
  terms?: unknown;
};

export type TimelineSegment = {
  key: TermKey;
  classId: string;
  className: string;
  classMissing: boolean;
  grade: number | null;
  term: ClassTerm;
  attendanceMode: AttendanceMode;
};

export type TimelineEvidence = {
  classes: ClassLike[];
  currentClassId: string | null;
  attendance: { classId: string; date: string }[];
  ledgers: { classId?: string | null; termStart?: unknown; termEnd?: unknown }[];
  enrollments?: { classId: string; termStart?: unknown }[];
};

export function makeTermKey(classId: string, termId: string): TermKey {
  return `${classId}::${termId}`;
}

function dateText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [];
}

function readSchedule(source: {
  holidays?: unknown;
  weeklySessions?: unknown;
  daysOfWeek?: unknown;
}): TermSchedule | null {
  const hasSnapshot =
    Array.isArray(source.holidays) ||
    Array.isArray(source.weeklySessions) ||
    Array.isArray(source.daysOfWeek);
  if (!hasSnapshot) return null;

  return {
    holidays: stringList(source.holidays),
    weeklySessions: Array.isArray(source.weeklySessions) ? source.weeklySessions : [],
    daysOfWeek: numberList(source.daysOfWeek),
  };
}

/**
 * Build the ordered course list for a class: archived `terms[]` plus the
 * current course. Deduped by (startDate, endDate); the current course wins.
 */
export function buildClassTerms(classData: ClassLike): ClassTerm[] {
  const archivedRaw = Array.isArray(classData.terms) ? classData.terms : [];

  const archived = archivedRaw
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => ({
      termId: String(t.id || ''),
      classId: classData.id,
      index: 0,
      startDate: dateText(t.startDate),
      endDate: dateText(t.endDate),
      isCurrent: false,
      schedule: readSchedule(t),
    }))
    .filter((t) => Boolean(t.termId && t.startDate));

  const currentStart = dateText(classData.startDate);
  const current: ClassTerm[] = currentStart
    ? [
        {
          termId: CURRENT_TERM_ID,
          classId: classData.id,
          index: 0,
          startDate: currentStart,
          endDate: dateText(classData.endDate),
          isCurrent: true,
          schedule: readSchedule(classData),
        },
      ]
    : [];

  const seen = new Set<string>();
  const deduped: ClassTerm[] = [];
  // Current first so it wins a (start,end) collision, then restore date order.
  for (const term of [...current, ...archived]) {
    const dedupeKey = `${term.startDate}|${term.endDate}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(term);
  }

  return deduped
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((term, i) => ({ ...term, index: i + 1 }));
}

/**
 * Find the course of a class containing `date`, or null when in a gap.
 * Terms arrive sorted by startDate, so overlapping intervals resolve to the
 * earliest-starting course. Overlaps can genuinely occur: reset-course
 * validates only date format, never the new range against archived terms.
 */
export function findTermForDate(terms: ClassTerm[], date: string): ClassTerm | null {
  const target = dateText(date);
  if (!target) return null;

  return (
    terms.find(
      (term) => term.startDate <= target && (term.endDate === '' || target <= term.endDate)
    ) ?? null
  );
}

function unknownTerm(classId: string): ClassTerm {
  return {
    termId: UNKNOWN_TERM_ID,
    classId,
    index: 0,
    startDate: '',
    endDate: '',
    isCurrent: false,
    schedule: null,
  };
}

function modeForTerm(term: ClassTerm): AttendanceMode {
  if (term.termId === UNKNOWN_TERM_ID) return 'marked_only';
  if (term.isCurrent) return 'expected';
  return term.schedule ? 'expected' : 'marked_only';
}

/**
 * Reconstruct the ordered list of (class, course) segments the student
 * actually took.
 *
 * Evidence gate: a segment is included only when the student has at least one
 * attendance row or ledger for it. `class.terms[]` holds every course the
 * class ever ran — including ones predating this student — so without the gate
 * a student who joined at course 4 would show three fabricated 100%-absent
 * segments.
 *
 * One exception: the current course of the student's current class is always
 * included, because `student.classId` is itself proof of present enrolment and
 * a newly-enrolled student has no rows yet. Sibling courses of that class are
 * not exempt.
 */
export function buildEnrollmentTimeline(evidence: TimelineEvidence): TimelineSegment[] {
  const classById = new Map(evidence.classes.map((c) => [c.id, c]));
  const termsByClass = new Map<string, ClassTerm[]>();
  for (const classData of evidence.classes) {
    termsByClass.set(classData.id, buildClassTerms(classData));
  }

  const termByKey = new Map<TermKey, ClassTerm>();
  const evidenced = new Set<TermKey>();

  const markEvidence = (classId: string, term: ClassTerm) => {
    const key = makeTermKey(classId, term.termId);
    if (!termByKey.has(key)) termByKey.set(key, term);
    evidenced.add(key);
  };

  for (const row of evidence.attendance) {
    if (!row.classId) continue;
    const terms = termsByClass.get(row.classId) ?? [];
    markEvidence(row.classId, findTermForDate(terms, row.date) ?? unknownTerm(row.classId));
  }

  for (const ledger of evidence.ledgers) {
    const classId = typeof ledger.classId === 'string' ? ledger.classId : '';
    if (!classId) continue;
    const terms = termsByClass.get(classId) ?? [];
    const termStart = dateText(ledger.termStart);
    const termEnd = dateText(ledger.termEnd);
    const matched = terms.find((t) => t.startDate === termStart && t.endDate === termEnd);
    markEvidence(classId, matched ?? unknownTerm(classId));
  }

  for (const enrollment of evidence.enrollments ?? []) {
    if (!enrollment.classId) continue;
    const terms = termsByClass.get(enrollment.classId) ?? [];
    const termStart = dateText(enrollment.termStart);
    const matched = terms.find((term) => term.startDate === termStart);
    markEvidence(enrollment.classId, matched ?? unknownTerm(enrollment.classId));
  }

  // Gate exception: the current course of the current class is always present.
  if (evidence.currentClassId) {
    const terms = termsByClass.get(evidence.currentClassId) ?? [];
    const currentTerm = terms.find((t) => t.isCurrent);
    if (currentTerm) markEvidence(evidence.currentClassId, currentTerm);
  }

  const segments: TimelineSegment[] = [];
  for (const key of evidenced) {
    const term = termByKey.get(key)!;
    const classData = classById.get(term.classId);
    segments.push({
      key,
      classId: term.classId,
      className: classData ? String(classData.name || '') : '',
      classMissing: !classData,
      grade: classData && Number(classData.grade) > 0 ? Number(classData.grade) : null,
      term,
      attendanceMode: modeForTerm(term),
    });
  }

  return segments.sort((a, b) => {
    // Unknown buckets sort last within their class.
    const aStart = a.term.startDate || '9999-12-31';
    const bStart = b.term.startDate || '9999-12-31';
    if (aStart !== bStart) return aStart.localeCompare(bStart);
    return a.classId.localeCompare(b.classId);
  });
}
