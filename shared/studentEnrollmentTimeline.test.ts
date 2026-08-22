import { describe, expect, it } from 'vitest';
import {
  buildClassTerms,
  buildEnrollmentTimeline,
  findTermForDate,
  makeTermKey,
  UNKNOWN_TERM_ID,
  CURRENT_TERM_ID,
  type ClassLike,
} from './studentEnrollmentTimeline';

const CLASS_3B: ClassLike = {
  id: 'cls-3b',
  name: 'Lớp 3B',
  grade: 3,
  startDate: '2026-05-01',
  endDate: '2026-08-31',
  holidays: ['2026-05-01'],
  weeklySessions: [{ dayOfWeek: 2 }],
  daysOfWeek: [2],
  terms: [
    { id: 'term_1', name: 'Khoa 1', startDate: '2025-09-01', endDate: '2025-12-31' },
    {
      id: 'term_2',
      name: 'Khoa 2',
      startDate: '2026-01-01',
      endDate: '2026-04-30',
      holidays: ['2026-02-10'],
      weeklySessions: [{ dayOfWeek: 3 }],
      daysOfWeek: [3],
    },
  ],
};

const CLASS_4A: ClassLike = {
  id: 'cls-4a',
  name: 'Lớp 4A',
  grade: 4,
  startDate: '2027-01-01',
  endDate: '',
  terms: [{ id: 'term_9', name: 'Khoa 1', startDate: '2026-09-01', endDate: '2026-12-31' }],
};

describe('buildClassTerms', () => {
  it('returns archived terms plus the current term, ordered and indexed', () => {
    const terms = buildClassTerms(CLASS_3B);

    expect(terms.map((t) => [t.termId, t.index, t.startDate, t.isCurrent])).toEqual([
      ['term_1', 1, '2025-09-01', false],
      ['term_2', 2, '2026-01-01', false],
      [CURRENT_TERM_ID, 3, '2026-05-01', true],
    ]);
  });

  it('exposes a schedule snapshot only when the archived term carries one', () => {
    const terms = buildClassTerms(CLASS_3B);

    expect(terms[0].schedule).toBeNull();
    expect(terms[1].schedule).toEqual({
      holidays: ['2026-02-10'],
      weeklySessions: [{ dayOfWeek: 3 }],
      daysOfWeek: [3],
    });
    expect(terms[2].schedule).toEqual({
      holidays: ['2026-05-01'],
      weeklySessions: [{ dayOfWeek: 2 }],
      daysOfWeek: [2],
    });
  });

  it('dedupes terms sharing a start and end date', () => {
    const terms = buildClassTerms({
      id: 'c',
      startDate: '2026-01-01',
      endDate: '2026-04-30',
      terms: [{ id: 'term_dup', startDate: '2026-01-01', endDate: '2026-04-30' }],
    });

    expect(terms).toHaveLength(1);
    expect(terms[0].isCurrent).toBe(true);
  });

  it('treats an empty endDate as open-ended', () => {
    const terms = buildClassTerms(CLASS_4A);
    const current = terms.find((t) => t.isCurrent);

    expect(current?.endDate).toBe('');
  });
});

describe('findTermForDate', () => {
  const terms = buildClassTerms(CLASS_3B);

  it('matches a date inside a closed term', () => {
    expect(findTermForDate(terms, '2025-10-05')?.termId).toBe('term_1');
  });

  it('matches boundary dates inclusively', () => {
    expect(findTermForDate(terms, '2025-09-01')?.termId).toBe('term_1');
    expect(findTermForDate(terms, '2025-12-31')?.termId).toBe('term_1');
  });

  it('matches any later date inside an open-ended term', () => {
    const openTerms = buildClassTerms(CLASS_4A);
    expect(findTermForDate(openTerms, '2099-01-01')?.termId).toBe(CURRENT_TERM_ID);
  });

  it('returns null for a date in a gap between terms', () => {
    expect(findTermForDate(terms, '2024-01-01')).toBeNull();
  });

  it('prefers the earliest-starting course when intervals overlap', () => {
    // reset-course validates only date FORMAT, not the new range against
    // archived terms — overlaps are real data, not just bad data.
    const overlapping = buildClassTerms({
      id: 'c',
      startDate: '2026-03-01',
      endDate: '2026-06-30',
      terms: [{ id: 'term_a', startDate: '2026-01-01', endDate: '2026-04-30' }],
    });

    expect(findTermForDate(overlapping, '2026-03-15')?.termId).toBe('term_a');
  });
});

describe('buildEnrollmentTimeline', () => {
  it('builds one ordered segment per course the student has evidence for', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B, CLASS_4A],
      currentClassId: 'cls-4a',
      attendance: [
        { classId: 'cls-3b', date: '2025-10-05' },
        { classId: 'cls-3b', date: '2026-02-03' },
        { classId: 'cls-3b', date: '2026-06-02' },
        { classId: 'cls-4a', date: '2026-09-08' },
        { classId: 'cls-4a', date: '2027-01-05' },
      ],
      ledgers: [],
    });

    expect(segments.map((s) => s.key)).toEqual([
      makeTermKey('cls-3b', 'term_1'),
      makeTermKey('cls-3b', 'term_2'),
      makeTermKey('cls-3b', CURRENT_TERM_ID),
      makeTermKey('cls-4a', 'term_9'),
      makeTermKey('cls-4a', CURRENT_TERM_ID),
    ]);
    expect(segments).toHaveLength(5);
    expect(segments[0].className).toBe('Lớp 3B');
    expect(segments[0].grade).toBe(3);
  });

  it('excludes courses that ran before the student joined the class', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B],
      currentClassId: null,
      attendance: [{ classId: 'cls-3b', date: '2026-06-02' }],
      ledgers: [],
    });

    expect(segments.map((s) => s.term.termId)).toEqual([CURRENT_TERM_ID]);
  });

  it('accepts a ledger alone as evidence', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B],
      currentClassId: null,
      attendance: [],
      ledgers: [{ classId: 'cls-3b', termStart: '2025-09-01', termEnd: '2025-12-31' }],
    });

    expect(segments.map((s) => s.term.termId)).toEqual(['term_1']);
  });

  it('always includes the current course of the current class without evidence', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B],
      currentClassId: 'cls-3b',
      attendance: [],
      ledgers: [],
    });

    expect(segments.map((s) => s.term.termId)).toEqual([CURRENT_TERM_ID]);
  });

  it('does not let sibling courses of the current class in via the exception', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B],
      currentClassId: 'cls-3b',
      attendance: [],
      ledgers: [],
    });

    expect(segments.map((s) => s.term.termId)).not.toContain('term_1');
    expect(segments).toHaveLength(1);
  });

  it('assigns marked_only to archived courses without a snapshot', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B],
      currentClassId: 'cls-3b',
      attendance: [
        { classId: 'cls-3b', date: '2025-10-05' },
        { classId: 'cls-3b', date: '2026-02-03' },
      ],
      ledgers: [],
    });

    const byTerm = Object.fromEntries(segments.map((s) => [s.term.termId, s.attendanceMode]));
    expect(byTerm.term_1).toBe('marked_only');
    expect(byTerm.term_2).toBe('expected');
    expect(byTerm[CURRENT_TERM_ID]).toBe('expected');
  });

  it('buckets unattributable attendance into an unknown course per class', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B],
      currentClassId: null,
      attendance: [{ classId: 'cls-3b', date: '2024-01-01' }],
      ledgers: [],
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].term.termId).toBe(UNKNOWN_TERM_ID);
    expect(segments[0].attendanceMode).toBe('marked_only');
  });

  it('buckets a ledger with no matching term into the unknown course', () => {
    const segments = buildEnrollmentTimeline({
      classes: [CLASS_3B],
      currentClassId: null,
      attendance: [],
      ledgers: [{ classId: 'cls-3b', termStart: '', termEnd: '' }],
    });

    expect(segments.map((s) => s.term.termId)).toEqual([UNKNOWN_TERM_ID]);
  });

  it('surfaces a segment for a class whose document is missing', () => {
    const segments = buildEnrollmentTimeline({
      classes: [],
      currentClassId: null,
      attendance: [{ classId: 'cls-gone', date: '2026-03-03' }],
      ledgers: [],
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].classMissing).toBe(true);
    expect(segments[0].classId).toBe('cls-gone');
    expect(segments[0].className).toBe('');
    expect(segments[0].attendanceMode).toBe('marked_only');
  });
});
