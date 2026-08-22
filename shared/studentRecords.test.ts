import { describe, expect, it } from 'vitest';
import { getCurrentStudentHeadcount, selectEnrolledStudentRows } from './studentRecords';

describe('getCurrentStudentHeadcount', () => {
  it('separates enrolled active, trial, and on-leave students in the canonical roster', () => {
    const students = [
      {
        id: 'active',
        studentId: 'HS01',
        name: 'Active Student',
        dob: '2012-01-01',
        studentLifecycle: 'enrolled',
        enrollmentStatus: 'active',
      },
      {
        id: 'on-leave',
        studentId: 'HS02',
        name: 'On Leave Student',
        dob: '2012-02-02',
        studentLifecycle: 'enrolled',
        enrollmentStatus: 'on_leave',
      },
      {
        id: 'trial',
        studentId: 'HS03',
        name: 'Trial Student',
        dob: '2012-03-03',
        studentLifecycle: 'trial',
        enrollmentStatus: 'active',
      },
      {
        id: 'archived',
        studentId: 'HS04',
        name: 'Archived Student',
        dob: '2012-04-04',
        studentLifecycle: 'archived',
        enrollmentStatus: 'active',
      },
      {
        id: 'dropped',
        studentId: 'HS05',
        name: 'Dropped Student',
        dob: '2012-05-05',
        studentLifecycle: 'enrolled',
        enrollmentStatus: 'dropped',
      },
      {
        id: 'promoted',
        studentId: 'HS06',
        name: 'Promoted Student',
        dob: '2012-06-06',
        studentLifecycle: 'enrolled',
        enrollmentStatus: 'promoted',
      },
    ];

    expect(getCurrentStudentHeadcount(students)).toEqual({
      total: 3,
      active: 1,
      trial: 1,
      onLeave: 1,
    });
  });
});

/**
 * The half of the legacy helpers that was never about identity.
 *
 * `getCurrentStudentRoster` bundled two decisions: which physical rows are the
 * same human, and which students are currently enrolled. The server owns the
 * first now. Serving code still needs the second, and it must get it without
 * the first attached — otherwise every list that wants "who is enrolled" also
 * silently re-decides who is who.
 */
describe('selectEnrolledStudentRows', () => {
  it('keeps enrolled and trial students and drops the rest', () => {
    const rows = [
      { id: 'a', studentLifecycle: 'enrolled', enrollmentStatus: 'active' },
      { id: 'b', studentLifecycle: 'trial', enrollmentStatus: 'active' },
      { id: 'c', studentLifecycle: 'enrolled', enrollmentStatus: 'on_leave' },
      { id: 'd', studentLifecycle: 'enrolled', enrollmentStatus: 'dropped' },
      { id: 'e', studentLifecycle: 'enrolled', enrollmentStatus: 'promoted' },
      { id: 'f', studentLifecycle: 'archived', enrollmentStatus: 'active' },
    ];

    expect(selectEnrolledStudentRows(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps two rows that look like the same human', () => {
    // The point of the split. Two rows sharing a code is a duplicate the
    // server is responsible for; collapsing it here is a guess, and it was
    // wrong for every one of the fifty-nine doubly-owned codes in production.
    const rows = [
      { id: 'first', studentId: 'HS260167', name: 'A', studentLifecycle: 'enrolled' },
      { id: 'second', studentId: 'HS260167', name: 'A', studentLifecycle: 'enrolled' },
    ];

    expect(selectEnrolledStudentRows(rows).map((row) => row.id)).toEqual(['first', 'second']);
  });

  it('scopes to one class without deciding identity', () => {
    const rows = [
      { id: 'in', classId: 'class-g7', studentLifecycle: 'enrolled' },
      { id: 'out', classId: 'class-g6', studentLifecycle: 'enrolled' },
    ];

    expect(selectEnrolledStudentRows(rows, 'class-g7').map((row) => row.id)).toEqual(['in']);
  });
});
