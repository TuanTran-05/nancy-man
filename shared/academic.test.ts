import { describe, expect, it } from 'vitest';
import {
  isCurrentAcademicCourseRecord,
  isCurrentAcademicStudent,
  isRequiredAcademicEvaluationStudent,
  normalizeAcademicEnrollmentStatus,
  selectMidtermEvaluation,
} from './academic';

describe('academic student status helpers', () => {
  it('normalizes academic enrollment statuses', () => {
    expect(normalizeAcademicEnrollmentStatus(' ON_LEAVE ')).toBe('on_leave');
    expect(normalizeAcademicEnrollmentStatus('ACTIVE')).toBe('active');
    expect(normalizeAcademicEnrollmentStatus(undefined)).toBe('active');
  });

  it('treats uppercase on-leave students as current but not required for evaluation', () => {
    const student = { enrollmentStatus: 'ON_LEAVE' };

    expect(isCurrentAcademicStudent(student)).toBe(true);
    expect(isRequiredAcademicEvaluationStudent(student)).toBe(false);
  });
});

describe('academic course record helpers', () => {
  it('prioritizes an explicit term id over a record date', () => {
    const classData = {
      startDate: '2026-07-13',
      endDate: '2026-09-06',
      terms: [{ id: 'term_2026_05', startDate: '2026-05-17', endDate: '2026-07-12' }],
    };

    expect(
      isCurrentAcademicCourseRecord(
        { termId: 'term_2026_05', date: '2026-07-13' },
        classData
      )
    ).toBe(false);
    expect(
      isCurrentAcademicCourseRecord({ termId: 'current', date: '2026-07-12' }, classData)
    ).toBe(true);
  });

  it('matches tuition notice logs that store courseEndDate in display date format', () => {
    expect(
      isCurrentAcademicCourseRecord(
        {
          type: 'tuition_notice',
          courseEndDate: '27/06/2026',
        },
        {
          startDate: '2026-05-01',
          endDate: '2026-06-27',
          terms: [{ startDate: '2026-05-01', endDate: '2026-06-27' }],
        }
      )
    ).toBe(true);
  });

  it('does not treat explicitly dated previous-course evaluations as current when class terms are missing', () => {
    expect(
      isCurrentAcademicCourseRecord(
        {
          evaluationType: 'final',
          termStart: '2026-05-19',
          termEnd: '2026-07-19',
          date: '2026-09-04',
        },
        {
          startDate: '2026-07-15',
          endDate: '2026-09-04',
        }
      )
    ).toBe(false);
  });

  it('does not treat next-course tuition logs for a mismatched period as current when class terms are missing', () => {
    expect(
      isCurrentAcademicCourseRecord(
        {
          type: 'tuition_notice',
          courseEndDate: '19/07/2026',
          nextCourseStartDate: '22/07/2026',
          nextCourseEndDate: '11/09/2026',
        },
        {
          startDate: '2026-07-15',
          endDate: '2026-09-04',
        }
      )
    ).toBe(false);
  });
});

describe('selectMidtermEvaluation', () => {
  it('returns the newest explicit midterm evaluation', () => {
    const evals = [
      { id: '1', evaluationType: 'midterm', date: '2026-06-01' },
      { id: '2', evaluationType: 'midterm', date: '2026-06-15' },
      { id: '3', evaluationType: 'final', date: '2026-07-01' },
      { id: '4', date: '2026-06-20' }, // untyped legacy evaluation
    ];
    expect(selectMidtermEvaluation(evals)?.id).toBe('2');
  });

  it('returns null when no explicit midterm evaluation exists', () => {
    const evals = [
      { id: '1', evaluationType: 'final', date: '2026-07-01' },
      { id: '2', date: '2026-06-20' },
    ];
    expect(selectMidtermEvaluation(evals)).toBeNull();
  });
});

