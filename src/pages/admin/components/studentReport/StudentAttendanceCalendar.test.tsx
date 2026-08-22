// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentAttendanceCalendar } from './StudentAttendanceCalendar';
import { translations } from '../../../../lib/i18n/translations';
import type { CalendarCell } from '../../../../lib/reports/studentAttendanceCalendar';

// Use real translations per spec — catches missing or mis-shaped locale keys.
const tVi = (translations.vi as any).studentAdminReportPage;
const tEn = (translations.en as any).studentAdminReportPage;

const CLASS_MAP: Record<string, string> = {
  'cls-a': 'Lớp A',
  'cls-b': 'Lớp B',
};

function makeCell(iso: string, opts: Partial<CalendarCell> = {}): CalendarCell {
  const [, , dayStr] = iso.split('-');
  return {
    iso,
    day: parseInt(dayStr, 10),
    inMonth: true,
    isToday: false,
    coverage: 'covered',
    sessions: [],
    ...opts,
  };
}

describe('StudentAttendanceCalendar — empty cell labels', () => {
  it('shows noClassLabel for covered+expected empty cells in vi', () => {
    const cells: CalendarCell[] = [makeCell('2026-07-10', { coverage: 'covered', sessions: [] })];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    // Label appears in both cell and legend, so use getAllByText
    expect(screen.getAllByText('Không có lịch học').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Không có dữ liệu')).not.toBeInTheDocument();
  });

  it('shows noDataLabel (not noClassLabel) for future empty cells in expected mode', () => {
    const cells: CalendarCell[] = [makeCell('2026-07-20', { coverage: 'future', sessions: [] })];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Không có lịch học')).not.toBeInTheDocument();
  });

  it('shows noDataLabel for outside_range empty cells in expected mode', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-03', { coverage: 'outside_range', sessions: [] }),
    ];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Không có lịch học')).not.toBeInTheDocument();
  });

  it('shows noDataLabel for covered+empty cells in marked_only mode', () => {
    const cells: CalendarCell[] = [makeCell('2026-07-10', { coverage: 'covered', sessions: [] })];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="marked_only"
        t={tVi}
      />
    );
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Không có lịch học')).not.toBeInTheDocument();
  });

  it('shows noDataLabel for covered+empty cells in mixed mode', () => {
    const cells: CalendarCell[] = [makeCell('2026-07-10', { coverage: 'covered', sessions: [] })];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="mixed"
        t={tVi}
      />
    );
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(1);
  });

  it('both legend entries appear when a grid needs both', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-10', { coverage: 'covered', sessions: [] }), // no_class
      makeCell('2026-07-20', { coverage: 'future', sessions: [] }), // no_data
    ];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    // Both labels should appear (in cells and/or legend)
    expect(screen.getAllByText('Không có lịch học').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(1);
  });

  it('neither legend entry appears when all visible cells have sessions', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-10', {
        coverage: 'covered',
        sessions: [{ classId: 'cls-a', statusKey: 'present', minutesLate: 0, isMakeup: false }],
      }),
    ];
    const { container } = render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    // Legend should not be rendered at all — check for legend container
    expect(container.querySelector('.flex.gap-4.px-3')).toBeNull();
  });
});

describe('StudentAttendanceCalendar — chips', () => {
  it('a cell with sessions renders chips regardless of coverage', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-20', {
        coverage: 'future',
        sessions: [{ classId: 'cls-a', statusKey: 'present', minutesLate: 0, isMakeup: false }],
      }),
    ];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    expect(screen.getByText('Có mặt')).toBeInTheDocument();
  });

  it('makeup marker is shown for makeup sessions', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-10', {
        coverage: 'covered',
        sessions: [{ classId: 'cls-a', statusKey: 'present', minutesLate: 0, isMakeup: true }],
      }),
    ];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    // makeupLabel is '↻'
    expect(screen.getByText('↻')).toBeInTheDocument();
  });

  it('late-minutes label is shown for late sessions', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-10', {
        coverage: 'covered',
        sessions: [{ classId: 'cls-a', statusKey: 'late', minutesLate: 15, isMakeup: false }],
      }),
    ];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    expect(screen.getByText(/15/)).toBeInTheDocument();
  });

  it('class name is shown when showClassName is true', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-10', {
        coverage: 'covered',
        sessions: [{ classId: 'cls-a', statusKey: 'present', minutesLate: 0, isMakeup: false }],
      }),
    ];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={true}
        attendanceMode="expected"
        t={tVi}
      />
    );
    expect(screen.getByText('Lớp A')).toBeInTheDocument();
  });

  it('class name is hidden when showClassName is false', () => {
    const cells: CalendarCell[] = [
      makeCell('2026-07-10', {
        coverage: 'covered',
        sessions: [{ classId: 'cls-a', statusKey: 'present', minutesLate: 0, isMakeup: false }],
      }),
    ];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tVi}
      />
    );
    expect(screen.queryByText('Lớp A')).not.toBeInTheDocument();
  });

  it('works with English translations', () => {
    const cells: CalendarCell[] = [makeCell('2026-07-10', { coverage: 'covered', sessions: [] })];
    render(
      <StudentAttendanceCalendar
        cells={cells}
        classMap={CLASS_MAP}
        showClassName={false}
        attendanceMode="expected"
        t={tEn}
      />
    );
    expect(screen.getAllByText('No class scheduled').length).toBeGreaterThanOrEqual(1);
  });
});
