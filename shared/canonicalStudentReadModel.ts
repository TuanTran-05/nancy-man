import type { StudentCourseEnrollmentStatus } from './studentCourseEnrollment.js';

/**
 * The shape every student-facing surface will read, and the one derivation
 * that decides what a student's current situation actually is.
 *
 * The important thing this file does is refuse to express `promoted`.
 *
 * `promoted` was never a fact about a student. It was a marker the old archive
 * path stamped on a profile it was about to clone — "this one is finished, make
 * a new one for next term" — and every duplicate in production began with one.
 * Reading it back as a status is what made the duplicates look legitimate: the
 * old row said `promoted`, the new row said `active`, and both looked correct
 * in isolation.
 *
 * The honest version of that situation is `waiting_for_placement`: one profile,
 * no open enrollment, waiting for its next class. It is derivable from the
 * enrollment record alone, which means it cannot drift the way a stamped field
 * does.
 */

export type CanonicalStudentPlacementStatus =
  | 'trial'
  | 'studying'
  | 'on_leave'
  | 'waiting_for_placement'
  | 'inactive';

export type CanonicalStudentEnrollmentView = {
  id: string;
  classId: string;
  termStart: string;
  termEnd: string | null;
  joinedAt: string;
  /** Inclusive end date; dates after it are not_enrolled. Null for open enrollments. */
  endedAt?: string | null;
  status: StudentCourseEnrollmentStatus;
};

export type CanonicalStudentReadRow = {
  id: string;
  canonicalProfileId: string;
  requestedProfileId?: string;
  redirected: boolean;
  profile: Record<string, unknown>;
  currentEnrollment: CanonicalStudentEnrollmentView | null;
  lastEnrollment: CanonicalStudentEnrollmentView | null;
  currentClassId: string | null;
  currentTeacherId: string | null;
  placementStatus: CanonicalStudentPlacementStatus;
  /**
   * The exact enrollment that put this student on a scoped roster.
   * Only present when the caller requested a specific attendance term.
   * May be a closed (historical) enrollment different from currentEnrollment.
   */
  scopedEnrollment?: CanonicalStudentEnrollmentView | null;
};

export type CanonicalStudentReadMode =
  | 'legacy_compare'
  | 'canonical_preferred'
  | 'canonical_required';

const READ_MODES: readonly CanonicalStudentReadMode[] = [
  'legacy_compare',
  'canonical_preferred',
  'canonical_required',
];

export function isCanonicalStudentReadMode(value: unknown): value is CanonicalStudentReadMode {
  return typeof value === 'string' && (READ_MODES as readonly string[]).includes(value);
}

/** Ordered weakest to strictest, so a mode can never be silently rolled back. */
export function canonicalStudentReadModeRank(mode: CanonicalStudentReadMode): number {
  return READ_MODES.indexOf(mode);
}

const OPEN_STATUSES: readonly StudentCourseEnrollmentStatus[] = ['trial', 'active', 'on_leave'];

/**
 * Lifecycles that mean "this student is not currently with the center". An
 * open enrollment contradicts them outright rather than overriding them.
 */
const INACTIVE_LIFECYCLES = new Set(['archived', 'deleted', 'inactive']);

/** Lifecycles that legitimately have no enrollment history yet. */
const WAITING_LIFECYCLES = new Set(['pending', 'waitlist', 'waiting']);

function invariant(detail: string): never {
  throw Object.assign(new Error(`CANONICAL_STUDENT_PLACEMENT_INVARIANT: ${detail}`), {
    statusCode: 409,
  });
}

export function deriveCanonicalStudentPlacementStatus(input: {
  lifecycle: string;
  currentEnrollment: CanonicalStudentEnrollmentView | null;
  lastEnrollment: CanonicalStudentEnrollmentView | null;
}): CanonicalStudentPlacementStatus {
  const lifecycle = String(input.lifecycle || '').trim();
  const inactiveLifecycle = INACTIVE_LIFECYCLES.has(lifecycle);

  if (input.currentEnrollment) {
    if (!OPEN_STATUSES.includes(input.currentEnrollment.status)) {
      invariant(
        `currentEnrollment ${input.currentEnrollment.id} has closed status ${input.currentEnrollment.status}`
      );
    }
    if (inactiveLifecycle) {
      // Both cannot be true. Serving either one alone would put an archived
      // student back on a roster, or hide an enrolled one from it.
      invariant(
        `lifecycle ${lifecycle} contradicts open enrollment ${input.currentEnrollment.id}`
      );
    }
    if (input.currentEnrollment.status === 'trial') return 'trial';
    if (input.currentEnrollment.status === 'on_leave') return 'on_leave';
    return 'studying';
  }

  if (inactiveLifecycle) return 'inactive';

  if (!input.lastEnrollment) {
    // No open enrollment and no history at all. Only a waitlist lifecycle
    // explains that; anything else is a profile whose enrollments went missing.
    if (WAITING_LIFECYCLES.has(lifecycle)) return 'waiting_for_placement';
    invariant(`lifecycle ${lifecycle} has neither an open nor a historical enrollment`);
  }

  // Finished a course and has not started the next one. This is the state the
  // old code stamped `promoted` before cloning the profile.
  if (input.lastEnrollment.status === 'completed' || input.lastEnrollment.status === 'transferred') {
    return 'waiting_for_placement';
  }

  // Dropping out is a real exit, not a queue.
  return 'inactive';
}
