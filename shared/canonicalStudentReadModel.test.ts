import { describe, expect, it } from 'vitest';
import {
  deriveCanonicalStudentPlacementStatus,
  isCanonicalStudentReadMode,
  type CanonicalStudentEnrollmentView,
} from './canonicalStudentReadModel.js';

function enrollment(
  status: CanonicalStudentEnrollmentView['status'],
  overrides: Partial<CanonicalStudentEnrollmentView> = {}
): CanonicalStudentEnrollmentView {
  return {
    id: `enrollment-${status}`,
    classId: 'class-1',
    termStart: '2026-01-05',
    termEnd: '2026-06-30',
    joinedAt: '2026-01-05',
    status,
    ...overrides,
  };
}

/**
 * `promoted` is the state this whole program exists to delete. It was never a
 * fact about a student — it was a marker the old archive path stamped on a
 * profile it was about to clone, and every duplicate in production started
 * with one. The derivation below can produce `waiting_for_placement`, which is
 * the honest version of the same situation, and can never produce `promoted`.
 */
describe('deriveCanonicalStudentPlacementStatus', () => {
  it.each([
    ['trial', 'trial'],
    ['active', 'studying'],
    ['on_leave', 'on_leave'],
  ] as const)('maps one open %s enrollment to %s', (status, expected) => {
    expect(
      deriveCanonicalStudentPlacementStatus({
        lifecycle: 'enrolled',
        currentEnrollment: enrollment(status),
        lastEnrollment: enrollment(status),
      })
    ).toBe(expected);
  });

  it.each(['completed', 'transferred'] as const)(
    'maps a finished %s enrollment with nothing open to waiting_for_placement',
    (status) => {
      expect(
        deriveCanonicalStudentPlacementStatus({
          lifecycle: 'enrolled',
          currentEnrollment: null,
          lastEnrollment: enrollment(status),
        })
      ).toBe('waiting_for_placement');
    }
  );

  it('maps an explicit waitlist lifecycle with no enrollment history to waiting_for_placement', () => {
    expect(
      deriveCanonicalStudentPlacementStatus({
        lifecycle: 'pending',
        currentEnrollment: null,
        lastEnrollment: null,
      })
    ).toBe('waiting_for_placement');
  });

  it.each(['dropped', 'transferred', 'completed'] as const)(
    'maps an archived lifecycle with a %s last enrollment to inactive',
    (status) => {
      expect(
        deriveCanonicalStudentPlacementStatus({
          lifecycle: 'archived',
          currentEnrollment: null,
          lastEnrollment: enrollment(status),
        })
      ).toBe('inactive');
    }
  );

  it('maps an archived lifecycle with no enrollment history to inactive', () => {
    expect(
      deriveCanonicalStudentPlacementStatus({
        lifecycle: 'archived',
        currentEnrollment: null,
        lastEnrollment: null,
      })
    ).toBe('inactive');
  });

  it('maps an enrolled lifecycle whose last enrollment was dropped to inactive', () => {
    // Dropping out is a real exit, not a queue. Calling it
    // waiting_for_placement would put a student who left back on the roster.
    expect(
      deriveCanonicalStudentPlacementStatus({
        lifecycle: 'enrolled',
        currentEnrollment: null,
        lastEnrollment: enrollment('dropped'),
      })
    ).toBe('inactive');
  });

  it('never returns promoted for any input combination', () => {
    const lifecycles = ['enrolled', 'trial', 'pending', 'archived'];
    const statuses = ['trial', 'active', 'on_leave', 'completed', 'transferred', 'dropped'] as const;
    for (const lifecycle of lifecycles) {
      for (const status of statuses) {
        for (const open of [true, false]) {
          const isOpen = ['trial', 'active', 'on_leave'].includes(status);
          if (open && !isOpen) continue;
          // Skip the combinations the table declares invariant errors.
          if (open && lifecycle === 'archived') continue;
          const result = deriveCanonicalStudentPlacementStatus({
            lifecycle,
            currentEnrollment: open ? enrollment(status) : null,
            lastEnrollment: enrollment(status),
          });
          expect(result).not.toBe('promoted');
        }
      }
    }
  });

  it('throws when an open enrollment contradicts an archived lifecycle', () => {
    // Both cannot be true. Serving either one silently would put an archived
    // student back on a roster, or hide an enrolled one from it.
    expect(() =>
      deriveCanonicalStudentPlacementStatus({
        lifecycle: 'archived',
        currentEnrollment: enrollment('active'),
        lastEnrollment: enrollment('active'),
      })
    ).toThrow('CANONICAL_STUDENT_PLACEMENT_INVARIANT');
  });

  it('throws when an active lifecycle has no enrollment history at all', () => {
    expect(() =>
      deriveCanonicalStudentPlacementStatus({
        lifecycle: 'enrolled',
        currentEnrollment: null,
        lastEnrollment: null,
      })
    ).toThrow('CANONICAL_STUDENT_PLACEMENT_INVARIANT');
  });

  it('throws when a trial lifecycle has no enrollment history at all', () => {
    expect(() =>
      deriveCanonicalStudentPlacementStatus({
        lifecycle: 'trial',
        currentEnrollment: null,
        lastEnrollment: null,
      })
    ).toThrow('CANONICAL_STUDENT_PLACEMENT_INVARIANT');
  });
});

describe('isCanonicalStudentReadMode', () => {
  it.each(['legacy_compare', 'canonical_preferred', 'canonical_required'])(
    'accepts %s',
    (mode) => {
      expect(isCanonicalStudentReadMode(mode)).toBe(true);
    }
  );

  it.each(['', 'canonical', 'PREFERRED', null, undefined, 42, {}])(
    'rejects %j',
    (value) => {
      expect(isCanonicalStudentReadMode(value)).toBe(false);
    }
  );
});
