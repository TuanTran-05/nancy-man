import { createHash } from 'node:crypto';
import {
  assertValidStudentCourseEnrollment,
  makeStudentCourseEnrollmentId,
  type StudentCourseEnrollment,
} from '../../shared/studentCourseEnrollment.js';
import type {
  SafeEnrollmentExclusionCode,
  SafeEnrollmentPlan,
  SafeEnrollmentPlannerInput,
  SourceDoc,
} from './types.js';

export const SAFE_ENROLLMENT_MIGRATION_ID = 'safe-student-course-enrollments-v2' as const;
export const SAFE_ENROLLMENT_ACTOR_ID = `migration:${SAFE_ENROLLMENT_MIGRATION_ID}`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUSION_CODES: SafeEnrollmentExclusionCode[] = [
  'ARCHIVED_STUDENT',
  'NON_CURRENT_STATUS',
  'EXISTING_ENROLLMENT',
  'MISSING_CLASS_ID',
  'MISSING_CLASS',
  'INVALID_CLASS_START',
  'FUTURE_CLASS',
  'INVALID_CLASS_END',
  'ENDED_CLASS',
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function date(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function canonicalJson(value: unknown): string {
  const canonicalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(canonicalize);
    if (!current || typeof current !== 'object') return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  };
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function fingerprintStudentSource(doc: SourceDoc): string {
  return sha256(
    canonicalJson({
      id: doc.id,
      updateTime: doc.updateTime || null,
      classId: text(doc.data.classId) || null,
      studentLifecycle: text(doc.data.studentLifecycle) || null,
      enrollmentStatus: text(doc.data.enrollmentStatus) || null,
      enrollmentDate: date(doc.data.enrollmentDate),
    })
  );
}

export function fingerprintClassSource(doc: SourceDoc): string {
  const rawEnd = doc.data.endDate;
  return sha256(
    canonicalJson({
      id: doc.id,
      updateTime: doc.updateTime || null,
      startDate: date(doc.data.startDate),
      endDate: rawEnd === null || rawEnd === undefined || rawEnd === '' ? null : date(rawEnd),
    })
  );
}

function emptyExcluded(): Record<SafeEnrollmentExclusionCode, number> {
  return Object.fromEntries(EXCLUSION_CODES.map((code) => [code, 0])) as Record<
    SafeEnrollmentExclusionCode,
    number
  >;
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function boundedJoin(student: SourceDoc, termStart: string, termEnd: string | null): string {
  const enrollmentDate = date(student.data.enrollmentDate);
  if (!enrollmentDate || enrollmentDate < termStart) return termStart;
  if (termEnd && enrollmentDate > termEnd) return termEnd;
  return enrollmentDate;
}

function candidateEnrollment(input: {
  student: SourceDoc;
  classDoc: SourceDoc;
  termStart: string;
  termEnd: string | null;
  generatedAt: string;
}): StudentCourseEnrollment {
  const status = input.student.data.enrollmentStatus === 'on_leave' ? 'on_leave' : 'active';
  return {
    id: makeStudentCourseEnrollmentId(input.student.id, input.classDoc.id, input.termStart),
    studentId: input.student.id,
    classId: input.classDoc.id,
    termStart: input.termStart,
    termEnd: input.termEnd,
    status,
    joinedAt: boundedJoin(input.student, input.termStart, input.termEnd),
    endedAt: null,
    statusReason: 'safe_current_enrollment_backfill',
    source: 'backfill',
    confidence: 'inferred',
    statusChangedAt: input.generatedAt,
    statusChangedBy: SAFE_ENROLLMENT_ACTOR_ID,
    confirmedAt: null,
    confirmedBy: null,
    createdAt: input.generatedAt,
    updatedAt: input.generatedAt,
  };
}

export function planSafeStudentEnrollmentBackfill(
  input: SafeEnrollmentPlannerInput
): SafeEnrollmentPlan {
  const classById = new Map(input.classes.map((classDoc) => [classDoc.id, classDoc]));
  const excluded = emptyExcluded();
  const byStatus = { active: 0, on_leave: 0 };
  const invalidCandidateDocumentIds: string[] = [];
  const items = [...input.students]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((student) => {
      const classId = text(student.data.classId) || null;
      const exclude = (reason: SafeEnrollmentExclusionCode) => {
        excluded[reason] += 1;
        return { studentId: student.id, classId, decision: 'exclude' as const, reason };
      };

      if (student.data.studentLifecycle === 'archived') return exclude('ARCHIVED_STUDENT');
      if (
        student.data.enrollmentStatus !== 'active' &&
        student.data.enrollmentStatus !== 'on_leave'
      ) {
        return exclude('NON_CURRENT_STATUS');
      }
      if ((input.existingByStudent.get(student.id) || []).length > 0) {
        return exclude('EXISTING_ENROLLMENT');
      }
      if (!classId) return exclude('MISSING_CLASS_ID');
      const classDoc = classById.get(classId);
      if (!classDoc) return exclude('MISSING_CLASS');
      const termStart = date(classDoc.data.startDate);
      if (!termStart) return exclude('INVALID_CLASS_START');
      if (termStart > input.vietnamDate) return exclude('FUTURE_CLASS');

      const rawEnd = classDoc.data.endDate;
      const hasEnd = rawEnd !== null && rawEnd !== undefined && rawEnd !== '';
      const termEnd = hasEnd ? date(rawEnd) : null;
      if (hasEnd && !termEnd) return exclude('INVALID_CLASS_END');
      if (termEnd && termEnd < termStart) return exclude('INVALID_CLASS_END');
      if (termEnd && termEnd < input.vietnamDate) return exclude('ENDED_CLASS');

      const enrollment = candidateEnrollment({
        student,
        classDoc,
        termStart,
        termEnd,
        generatedAt: input.generatedAt,
      });
      try {
        assertValidStudentCourseEnrollment(enrollment);
      } catch {
        invalidCandidateDocumentIds.push(enrollment.id);
      }
      byStatus[enrollment.status as 'active' | 'on_leave'] += 1;
      return {
        studentId: student.id,
        classId,
        decision: 'create' as const,
        reason: 'SAFE_CURRENT_ENROLLMENT' as const,
        candidate: {
          enrollment,
          studentFingerprint: fingerprintStudentSource(student),
          classFingerprint: fingerprintClassSource(classDoc),
        },
      };
    });

  const candidates = items.flatMap((item) => (item.decision === 'create' ? [item.candidate] : []));
  return {
    migrationId: SAFE_ENROLLMENT_MIGRATION_ID,
    generatedAt: input.generatedAt,
    vietnamDate: input.vietnamDate,
    items,
    summary: {
      scannedStudents: input.students.length,
      create: candidates.length,
      excluded,
      byStatus,
    },
    invariants: {
      duplicateCandidateStudentIds: duplicates(
        candidates.map((candidate) => candidate.enrollment.studentId)
      ),
      duplicateCandidateDocumentIds: duplicates(
        candidates.map((candidate) => candidate.enrollment.id)
      ),
      invalidCandidateDocumentIds: [...new Set(invalidCandidateDocumentIds)].sort(),
    },
  };
}

export function assertSafeEnrollmentPlan(plan: SafeEnrollmentPlan): void {
  if (
    plan.invariants.duplicateCandidateStudentIds.length > 0 ||
    plan.invariants.duplicateCandidateDocumentIds.length > 0 ||
    plan.invariants.invalidCandidateDocumentIds.length > 0
  ) {
    throw new Error('SAFE_ENROLLMENT_PLAN_INVARIANT_FAILED');
  }
}
