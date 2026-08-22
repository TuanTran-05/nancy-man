import { describe, expect, it } from 'vitest';
import {
  buildExpectedStudentSessions,
  mergeExpectedSessionsWithAttendance,
  calculateStudentAttendanceSummary,
  classifyStudentAttendanceRow,
  resolveAttendanceCellStatus,
  type AttendanceRecord,
  type ExpectedSession,
} from './studentAttendanceReport.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    date: '2026-03-10',
    classId: 'class-1',
    status: 'present',
    isVoided: false,
    permission: false,
    minutesLate: 0,
    ...overrides,
  };
}

function makeExpected(overrides: Partial<ExpectedSession> = {}): ExpectedSession {
  return {
    date: '2026-03-10',
    classId: 'class-1',
    source: 'scheduled',
    eligibility: 'eligible',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildExpectedStudentSessions
// ---------------------------------------------------------------------------

describe('buildExpectedStudentSessions', () => {
  it('returns sessions sorted by date', () => {
    const result = buildExpectedStudentSessions(
      [
        { date: '2026-03-12', classId: 'class-1' },
        { date: '2026-03-10', classId: 'class-1' },
      ],
      [],
      new Set(),
    );
    expect(result.map((r) => r.date)).toEqual(['2026-03-10', '2026-03-12']);
  });

  it('deduplicates scheduled and makeup on same classId+date (scheduled wins)', () => {
    const result = buildExpectedStudentSessions(
      [{ date: '2026-03-10', classId: 'class-1' }],
      [{ date: '2026-03-10', classId: 'class-1' }],
      new Set(),
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('scheduled');
  });

  it('excludes sessions marked as cancelled', () => {
    const result = buildExpectedStudentSessions(
      [{ date: '2026-03-10', classId: 'class-1' }],
      [],
      new Set(['class-1|2026-03-10']),
    );
    expect(result).toHaveLength(0);
  });

  it('keeps ineligible sessions and labels them instead of dropping them', () => {
    const result = buildExpectedStudentSessions(
      [
        { date: '2026-03-08', classId: 'class-1' },
        { date: '2026-03-10', classId: 'class-1' },
      ],
      [],
      new Set(),
      (date) => (date < '2026-03-09' ? 'not_enrolled' : 'eligible'),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: '2026-03-08', eligibility: 'not_enrolled' });
    expect(result[1]).toMatchObject({ date: '2026-03-10', eligibility: 'eligible' });
  });

  it('defaults every session to eligible when no resolver is given', () => {
    const result = buildExpectedStudentSessions(
      [{ date: '2026-03-10', classId: 'class-1' }],
      [],
      new Set(),
    );
    expect(result[0].eligibility).toBe('eligible');
  });

  it('includes makeup sessions not in cancelled set', () => {
    const result = buildExpectedStudentSessions(
      [],
      [{ date: '2026-03-15', classId: 'class-1' }],
      new Set(),
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('makeup');
  });

  it('handles no sessions gracefully', () => {
    const result = buildExpectedStudentSessions([], [], new Set());
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mergeExpectedSessionsWithAttendance
// ---------------------------------------------------------------------------

describe('mergeExpectedSessionsWithAttendance', () => {
  it('maps present record correctly', () => {
    const expected = [makeExpected()];
    const records = [makeRecord({ status: 'present' })];
    const [row] = mergeExpectedSessionsWithAttendance(expected, records);
    expect(row.status).toBe('present');
    expect(row.absentWithPermission).toBe(false);
    expect(row.minutesLate).toBe(0);
  });

  it('maps late record and preserves minutesLate', () => {
    const expected = [makeExpected()];
    const records = [makeRecord({ status: 'late', minutesLate: 12 })];
    const [row] = mergeExpectedSessionsWithAttendance(expected, records);
    expect(row.status).toBe('late');
    expect(row.minutesLate).toBe(12);
  });

  it('maps absent without permission', () => {
    const expected = [makeExpected()];
    const records = [makeRecord({ status: 'absent', permission: false })];
    const [row] = mergeExpectedSessionsWithAttendance(expected, records);
    expect(row.status).toBe('absent');
    expect(row.absentWithPermission).toBe(false);
  });

  it('maps absent with permission', () => {
    const expected = [makeExpected()];
    const records = [makeRecord({ status: 'absent', permission: true })];
    const [row] = mergeExpectedSessionsWithAttendance(expected, records);
    expect(row.status).toBe('absent');
    expect(row.absentWithPermission).toBe(true);
  });

  it('produces unmarked when no attendance record exists', () => {
    const expected = [makeExpected()];
    const [row] = mergeExpectedSessionsWithAttendance(expected, []);
    expect(row.status).toBe('unmarked');
    expect(row.absentWithPermission).toBe(false);
  });

  it('ignores voided attendance records', () => {
    const expected = [makeExpected()];
    const records = [makeRecord({ status: 'present', isVoided: true })];
    const [row] = mergeExpectedSessionsWithAttendance(expected, records);
    expect(row.status).toBe('unmarked');
  });

  it('ignores attendance records with no matching expected session', () => {
    const expected = [makeExpected({ date: '2026-03-10' })];
    const records = [makeRecord({ date: '2026-04-01' })]; // no match
    const rows = mergeExpectedSessionsWithAttendance(expected, records);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('unmarked'); // expected session has no attendance
  });

  it('does not duplicate when classId differs', () => {
    const expected = [
      makeExpected({ classId: 'class-1' }),
      makeExpected({ classId: 'class-2' }),
    ];
    const records = [makeRecord({ classId: 'class-1', status: 'present' })];
    const rows = mergeExpectedSessionsWithAttendance(expected, records);
    expect(rows[0].status).toBe('present');
    expect(rows[1].status).toBe('unmarked');
  });
});

// ---------------------------------------------------------------------------
// calculateStudentAttendanceSummary
// ---------------------------------------------------------------------------

describe('calculateStudentAttendanceSummary', () => {
  it('returns all-zero summary for empty rows', () => {
    const summary = calculateStudentAttendanceSummary([]);
    expect(summary.expectedSessions).toBe(0);
    expect(summary.attendanceRate).toBeNull();
  });

  it('computes attendanceRate correctly (present + late / total)', () => {
    const rows = [
      { date: '2026-03-10', classId: 'c', status: 'present' as const, absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' as const },
      { date: '2026-03-11', classId: 'c', status: 'late' as const, absentWithPermission: false, minutesLate: 5, note: null, source: 'scheduled' as const },
      { date: '2026-03-12', classId: 'c', status: 'absent' as const, absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' as const },
      { date: '2026-03-13', classId: 'c', status: 'unmarked' as const, absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' as const },
    ];
    const summary = calculateStudentAttendanceSummary(rows);
    expect(summary.expectedSessions).toBe(4);
    expect(summary.markedSessions).toBe(3);
    expect(summary.present).toBe(1);
    expect(summary.late).toBe(1);
    expect(summary.absentWithoutPermission).toBe(1);
    expect(summary.absentWithPermission).toBe(0);
    expect(summary.unmarked).toBe(1);
    // attended = 1+1 = 2; rate = 2/4 * 100 = 50
    expect(summary.attendanceRate).toBeCloseTo(50);
  });

  it('classifies absent with permission separately', () => {
    const rows = [
      { date: '2026-03-10', classId: 'c', status: 'absent' as const, absentWithPermission: true, minutesLate: 0, note: null, source: 'scheduled' as const },
    ];
    const summary = calculateStudentAttendanceSummary(rows);
    expect(summary.absentWithPermission).toBe(1);
    expect(summary.absentWithoutPermission).toBe(0);
  });

  it('returns null attendanceRate when expectedSessions is 0', () => {
    expect(calculateStudentAttendanceSummary([]).attendanceRate).toBeNull();
  });

  it('counts late as attended (not absent)', () => {
    const rows = [
      { date: '2026-03-10', classId: 'c', status: 'late' as const, absentWithPermission: false, minutesLate: 7, note: null, source: 'scheduled' as const },
    ];
    const summary = calculateStudentAttendanceSummary(rows);
    expect(summary.attendanceRate).toBeCloseTo(100);
  });
});

// ---------------------------------------------------------------------------
// classifyStudentAttendanceRow
// ---------------------------------------------------------------------------

describe('classifyStudentAttendanceRow', () => {
  const base = { date: '2026-03-10', classId: 'c', minutesLate: 0, note: null, source: 'scheduled' as const };

  it('present', () => {
    expect(classifyStudentAttendanceRow({ ...base, status: 'present', absentWithPermission: false })).toBe('present');
  });
  it('late', () => {
    expect(classifyStudentAttendanceRow({ ...base, status: 'late', absentWithPermission: false })).toBe('late');
  });
  it('absent without permission', () => {
    expect(classifyStudentAttendanceRow({ ...base, status: 'absent', absentWithPermission: false })).toBe('absent_without_permission');
  });
  it('absent with permission', () => {
    expect(classifyStudentAttendanceRow({ ...base, status: 'absent', absentWithPermission: true })).toBe('absent_with_permission');
  });
  it('unmarked', () => {
    expect(classifyStudentAttendanceRow({ ...base, status: 'unmarked', absentWithPermission: false })).toBe('unmarked');
  });
});

// ---------------------------------------------------------------------------
// Eligibility labelling (spec D5 / D6)
// ---------------------------------------------------------------------------

describe('eligibility labelling', () => {
  it('reports an unmarked ineligible session with its eligibility status', () => {
    const rows = mergeExpectedSessionsWithAttendance(
      [makeExpected({ date: '2026-03-08', eligibility: 'not_enrolled' })],
      [],
    );
    expect(rows[0].status).toBe('not_enrolled');
  });

  it('reports an unmarked on-leave session as on_leave', () => {
    const rows = mergeExpectedSessionsWithAttendance(
      [makeExpected({ date: '2026-03-08', eligibility: 'on_leave' })],
      [],
    );
    expect(rows[0].status).toBe('on_leave');
  });

  // Spec D5: a real record always wins.
  it('lets a real attendance record override a not_enrolled label', () => {
    const rows = mergeExpectedSessionsWithAttendance(
      [makeExpected({ date: '2026-03-08', eligibility: 'not_enrolled' })],
      [makeRecord({ date: '2026-03-08', status: 'present' })],
    );
    expect(rows[0].status).toBe('present');
  });

  it('lets a real attendance record override an on_leave label', () => {
    const rows = mergeExpectedSessionsWithAttendance(
      [makeExpected({ date: '2026-03-08', eligibility: 'on_leave' })],
      [makeRecord({ date: '2026-03-08', status: 'absent', permission: true })],
    );
    expect(rows[0].status).toBe('absent');
    expect(rows[0].absentWithPermission).toBe(true);
  });

  it('does not let a voided record override the label', () => {
    const rows = mergeExpectedSessionsWithAttendance(
      [makeExpected({ date: '2026-03-08', eligibility: 'on_leave' })],
      [makeRecord({ date: '2026-03-08', status: 'present', isVoided: true })],
    );
    expect(rows[0].status).toBe('on_leave');
  });

  it('excludes ineligible sessions from the attendance denominator', () => {
    const summary = calculateStudentAttendanceSummary([
      { date: '2026-03-02', classId: 'class-1', status: 'not_enrolled', absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' },
      { date: '2026-03-05', classId: 'class-1', status: 'not_enrolled', absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' },
      { date: '2026-03-16', classId: 'class-1', status: 'present', absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' },
      { date: '2026-03-19', classId: 'class-1', status: 'absent', absentWithPermission: true, minutesLate: 0, note: null, source: 'scheduled' },
      { date: '2026-03-23', classId: 'class-1', status: 'on_leave', absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' },
      { date: '2026-03-30', classId: 'class-1', status: 'present', absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' },
    ]);

    expect(summary.notEnrolledSessions).toBe(2);
    expect(summary.onLeaveSessions).toBe(1);
    expect(summary.expectedSessions).toBe(3);
    expect(summary.present).toBe(2);
    expect(summary.absentWithPermission).toBe(1);
    expect(summary.attendanceRate).toBeCloseTo(66.667, 2);
  });

  it('classifies the new statuses for display', () => {
    const base = { date: '2026-03-08', classId: 'class-1', absentWithPermission: false, minutesLate: 0, note: null, source: 'scheduled' as const };
    expect(classifyStudentAttendanceRow({ ...base, status: 'not_enrolled' })).toBe('not_enrolled');
    expect(classifyStudentAttendanceRow({ ...base, status: 'on_leave' })).toBe('on_leave');
  });
});

// ---------------------------------------------------------------------------
// resolveAttendanceCellStatus
// ---------------------------------------------------------------------------

describe('resolveAttendanceCellStatus', () => {
  it.each(['not_enrolled', 'on_leave'] as const)(
    'keeps a real attendance record over %s eligibility',
    (eligibility) => {
      expect(
        resolveAttendanceCellStatus({
          eligibility,
          attendance: { date: '2026-03-10', classId: 'class-1', status: 'present' },
        })
      ).toBe('present');
    }
  );

  it('maps an eligible missing record to unmarked', () => {
    expect(resolveAttendanceCellStatus({ eligibility: 'eligible', attendance: null })).toBe(
      'unmarked'
    );
  });

  it('ignores a voided real-looking record', () => {
    expect(resolveAttendanceCellStatus({
      eligibility: 'on_leave',
      attendance: {
        date: '2026-03-10',
        classId: 'class-1',
        status: 'present',
        isVoided: true,
      },
    })).toBe('on_leave');
  });
});
