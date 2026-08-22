import { describe, expect, it } from 'vitest';
import { matchesStudentStatusFilter } from './statusFilters';
import { buildClassStudentCounts } from './classStudentCounts';

/**
 * The server now answers with `placementStatus`, derived from the enrollment.
 * The client used to derive the same idea from `studentLifecycle` +
 * `enrollmentStatus` on the profile — two fields that are projections of the
 * enrollment and go stale independently of it.
 *
 * These tests pin the precedence: where the server has spoken, the client
 * repeats it rather than recomputing, and where it has not (a response written
 * before this rollout) the old derivation still stands.
 */

describe('matchesStudentStatusFilter with a canonical placement status', () => {
  it('shows a student whose enrollment ended under "waiting for placement"', () => {
    // The profile still says `active` because nothing rewrote it when the
    // course closed. The enrollment is what knows the course ended.
    const student = {
      studentLifecycle: 'enrolled',
      enrollmentStatus: 'active',
      placementStatus: 'waiting_for_placement',
    };

    expect(matchesStudentStatusFilter(student, 'promoted')).toBe(true);
    expect(matchesStudentStatusFilter(student, 'active')).toBe(false);
  });

  it('reads studying as the active filter', () => {
    const student = { enrollmentStatus: 'promoted', placementStatus: 'studying' };

    expect(matchesStudentStatusFilter(student, 'active')).toBe(true);
    expect(matchesStudentStatusFilter(student, 'promoted')).toBe(false);
  });

  it('keeps trial and archived answering the lifecycle filters', () => {
    expect(
      matchesStudentStatusFilter({ studentLifecycle: 'trial', placementStatus: 'trial' }, 'trial')
    ).toBe(true);
    expect(
      matchesStudentStatusFilter(
        { studentLifecycle: 'archived', placementStatus: 'inactive' },
        'archived'
      )
    ).toBe(true);
  });

  it('falls back to the profile fields when the server sent no placement status', () => {
    const student = { studentLifecycle: 'enrolled', enrollmentStatus: 'on_leave' };

    expect(matchesStudentStatusFilter(student, 'on_leave')).toBe(true);
    expect(matchesStudentStatusFilter(student, 'active')).toBe(false);
  });

  it('matches everything under "all" regardless of source', () => {
    expect(matchesStudentStatusFilter({ placementStatus: 'inactive' }, 'all')).toBe(true);
  });
});

describe('buildClassStudentCounts with a canonical placement status', () => {
  it('counts a student by their enrollment, not by the stale profile status', () => {
    const counts = buildClassStudentCounts([
      { classId: 'class-g7', enrollmentStatus: 'promoted', placementStatus: 'studying' },
      { classId: 'class-g7', enrollmentStatus: 'active', placementStatus: 'on_leave' },
      { classId: 'class-g7', enrollmentStatus: 'active', placementStatus: 'trial' },
      {
        classId: 'class-g7',
        enrollmentStatus: 'active',
        placementStatus: 'waiting_for_placement',
      },
      { classId: 'class-g7', enrollmentStatus: 'active', placementStatus: 'inactive' },
    ]);

    expect(counts['class-g7']).toEqual({
      total: 5,
      active: 1,
      trial: 1,
      onLeave: 1,
      dropped: 1,
      promoted: 1,
    });
  });

  it('still counts a response written before the rollout', () => {
    const counts = buildClassStudentCounts([
      { classId: 'class-g7', enrollmentStatus: 'active' },
      { classId: 'class-g7', enrollmentStatus: 'on_leave' },
    ]);

    expect(counts['class-g7']).toMatchObject({ total: 2, active: 1, onLeave: 1 });
  });
});
