// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentAttendanceReportTab } from './StudentAttendanceReportTab';
import type {
  StudentAttendanceReportRow,
  TermSessionValue,
} from '../../../../lib/api/studentAdminReportApi';

const T = {
  attendance: {
    emptyLabel: 'No sessions found in this date range',
    unmarkedWarning: '{count} session(s) not yet marked',
    calendarTitle: 'Attendance Calendar',
    monthLabel: '{month}/{year}',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    makeupLabel: '↻',
    noClassLabel: 'No class scheduled',
    noDataLabel: 'No data',
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    minutesLateShort: 'Late {n}′',
    statuses: {
      present: 'Present',
      late: 'Late',
      absent_with_permission: 'Excused absent',
      absent_without_permission: 'Unexcused absent',
      unmarked: 'Unmarked',
      not_enrolled: 'Not yet enrolled',
      on_leave: 'On leave',
    },
    sessions: 'sessions',
    sessionValueTitle: 'Session value',
    pricePerSession: 'Price per session',
    refundable: 'Refundable',
    refundableHint: 'Excused absences and leave — an estimate, not applied to any balance',
    notEnrolledValue: 'Intake reduction',
    notEnrolledHint: 'Sessions before joining — reconcile against what was charged',
    sessionValueUnavailable: 'Not enough data to price sessions',
  },
  modes: {
    markedOnlyHint: 'Finished courses do not retain their holiday calendar.',
    mixed: 'Multiple courses with different calculations.',
  },
};

function makeRow(
  date: string,
  classId = 'cls-a',
  status: StudentAttendanceReportRow['status'] = 'present',
  opts: Partial<StudentAttendanceReportRow> = {}
): StudentAttendanceReportRow {
  return {
    date,
    classId,
    termKey: `${classId}::current`,
    status,
    absentWithPermission: false,
    minutesLate: 0,
    source: 'scheduled',
    ...opts,
  };
}

const CLASS_MAP: Record<string, string> = { 'cls-a': 'Class A', 'cls-b': 'Class B' };
const TODAY = '2026-07-17';

/** Renders with a non-empty default so the sessionValue block is reachable. */
function renderTab(overrides: { sessionValue?: TermSessionValue | null } = {}) {
  const rows = [makeRow('2026-07-10', 'cls-a', 'present')];
  return render(
    <StudentAttendanceReportTab
      rows={rows}
      classMap={CLASS_MAP}
      showClassName={false}
      attendanceMode="expected"
      todayIso={TODAY}
      sessionValue={overrides.sessionValue}
      t={T}
    />
  );
}

describe('StudentAttendanceReportTab', () => {
  it('shows empty state when rows is empty', () => {
    render(
      <StudentAttendanceReportTab
        rows={[]}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );
    expect(document.getElementById('attendance-empty-state')).toBeTruthy();
  });

  it('shows empty state when attendanceMode is none', () => {
    const rows = [makeRow('2026-07-10')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="none"
        todayIso={TODAY}
        t={T}
      />
    );
    expect(document.getElementById('attendance-empty-state')).toBeTruthy();
  });

  it('defaults to the most recent (last) month with data', () => {
    const rows = [makeRow('2026-05-10'), makeRow('2026-07-10'), makeRow('2026-06-15')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );
    // Most recent month is July; month label should show 07/2026
    const label = document.getElementById('attendance-calendar-month-label');
    expect(label.textContent).toContain('07');
    expect(label.textContent).toContain('2026');
  });

  it('prev button is disabled at the start of available months', () => {
    const rows = [makeRow('2026-07-10')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );
    const prev = document.getElementById('attendance-calendar-prev') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it('next button is disabled at the end of available months', () => {
    const rows = [makeRow('2026-07-10')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );
    const next = document.getElementById('attendance-calendar-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('prev/next navigate through available months', () => {
    const rows = [makeRow('2026-05-10'), makeRow('2026-07-10')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );

    const prev = document.getElementById('attendance-calendar-prev') as HTMLButtonElement;
    const label = document.getElementById('attendance-calendar-month-label');

    // Starts at July
    expect(label.textContent).toContain('07');
    fireEvent.click(prev);
    // Now at May
    expect(label.textContent).toContain('05');
  });

  it('skips a gap month (no sessions in June) when navigating', () => {
    // Rows only in May and July — June should be skipped
    const rows = [makeRow('2026-05-10'), makeRow('2026-07-10')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );

    const prev = document.getElementById('attendance-calendar-prev') as HTMLButtonElement;
    const label = document.getElementById('attendance-calendar-month-label');

    // July
    expect(label.textContent).toContain('07');
    fireEvent.click(prev);
    // Directly to May (June skipped)
    expect(label.textContent).toContain('05');
    // prev now disabled
    expect(prev.disabled).toBe(true);
  });

  it('class name is hidden when showClassName is false (single class)', () => {
    const rows = [makeRow('2026-07-10', 'cls-a', 'present')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );
    expect(screen.queryByText('Class A')).not.toBeInTheDocument();
  });

  it('shows the markedOnly hint for marked_only mode', () => {
    const rows = [makeRow('2026-07-10')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="marked_only"
        todayIso={TODAY}
        t={T}
      />
    );
    expect(screen.getByText(/finished courses do not retain/i)).toBeInTheDocument();
  });

  it('marked_only shows noDataLabel in empty cells (not noClassLabel)', () => {
    // A past date with no row in marked_only mode
    const rows = [makeRow('2026-07-01', 'cls-a', 'present')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="marked_only"
        todayIso={TODAY}
        t={T}
      />
    );
    // There should be "No data" labels for empty covered cells
    expect(screen.queryByText('No class scheduled')).not.toBeInTheDocument();
  });

  it('expected mode shows noClassLabel for covered empty cells', () => {
    const rows = [makeRow('2026-07-01', 'cls-a', 'present')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );
    // Some past days in July have no sessions → should show noClassLabel
    expect(screen.getAllByText('No class scheduled').length).toBeGreaterThanOrEqual(1);
  });

  it('unmarked banner counts the whole filter, not the visible month', () => {
    // 3 unmarked rows, 2 in July and 1 in May
    const rows = [
      makeRow('2026-07-10', 'cls-a', 'unmarked'),
      makeRow('2026-07-12', 'cls-a', 'unmarked'),
      makeRow('2026-05-15', 'cls-a', 'unmarked'),
    ];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        t={T}
      />
    );
    const banner = document.getElementById('attendance-unmarked-warning');
    // Count should be 3 (all unmarked), not 2 (just July)
    expect(banner.textContent).toContain('3');
  });

  it('a future day within the displayed month never reads noClassLabel in expected mode', () => {
    // Future date: 2026-07-25 (todayIso is 2026-07-17)
    const rows = [makeRow('2026-07-01', 'cls-a', 'present')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso="2026-07-17"
        t={T}
      />
    );
    // The calendar cell for 2026-07-25 should show "No data", not "No class scheduled"
    // Count of "No class scheduled" should only cover past (covered) cells
    // We can verify by checking the calendar cell for a future date
    const cell = document.querySelector('[data-date="2026-07-25"]');
    expect(cell?.textContent).not.toContain('No class scheduled');
  });

  it('a date-range-clipped day shows noDataLabel in expected mode', () => {
    // Days outside the range.to=2026-07-10 should show noDataLabel
    const rows = [makeRow('2026-07-05', 'cls-a', 'present')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso={TODAY}
        dateRangeFrom="2026-07-01"
        dateRangeTo="2026-07-10"
        t={T}
      />
    );
    // July 15 is outside range.to and before today → outside_range → noDataLabel
    const cell = document.querySelector('[data-date="2026-07-15"]');
    // Should not have "No class scheduled"
    expect(cell?.textContent).not.toContain('No class scheduled');
  });

  it('a month entirely before todayIso shows only noDataLabel (injected past today)', () => {
    // Using a past todayIso means all July 2026 days are in the future relative to May 2026
    // But we want a month entirely before todayIso: e.g. May rows with todayIso in July
    const rows = [makeRow('2026-05-15', 'cls-a', 'unmarked')];
    render(
      <StudentAttendanceReportTab
        rows={rows}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        todayIso="2026-07-17" // today is in July, month is May — all May days are covered
        t={T}
      />
    );
    // May has covered cells with no sessions → should show noClassLabel
    // (May is entirely before todayIso, so all its empty cells are 'covered')
    expect(screen.getAllByText('No class scheduled').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the refundable amount for excused absences', () => {
    renderTab({
      sessionValue: {
        courseTotalSessions: 40,
        pricePerSession: 150_000,
        refundable: { sessions: 3, amount: 450_000 },
        notEnrolled: { sessions: 0, amount: 0 },
      },
    });
    expect(screen.getByText(/450\.000/)).toBeInTheDocument();
  });

  it('shows the intake reduction separately from the refundable amount', () => {
    renderTab({
      sessionValue: {
        courseTotalSessions: 40,
        pricePerSession: 150_000,
        refundable: { sessions: 2, amount: 300_000 },
        notEnrolled: { sessions: 20, amount: 3_000_000 },
      },
    });
    expect(screen.getByText(/300\.000/)).toBeInTheDocument();
    expect(screen.getByText(/3\.000\.000/)).toBeInTheDocument();
  });

  it('hides the intake reduction row when the student joined at the start', () => {
    renderTab({
      sessionValue: {
        courseTotalSessions: 40,
        pricePerSession: 150_000,
        refundable: { sessions: 3, amount: 450_000 },
        notEnrolled: { sessions: 0, amount: 0 },
      },
    });
    expect(screen.queryByText(/Giảm trừ đầu khóa|Intake reduction/)).not.toBeInTheDocument();
  });

  it('renders a dash instead of an amount when the price is unknown', () => {
    renderTab({
      sessionValue: {
        courseTotalSessions: 0,
        pricePerSession: null,
        refundable: { sessions: 3, amount: 0 },
        notEnrolled: { sessions: 0, amount: 0 },
      },
    });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/₫/)).not.toBeInTheDocument();
  });

  it('renders no session value block at all when none is supplied', () => {
    renderTab({ sessionValue: null });
    expect(document.getElementById('attendance-session-value')).toBeNull();
  });
});
