// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentReportFilters } from './StudentReportFilters';
import { ALL } from '../../../../lib/reports/studentReportFilter';
import type { StudentTimelineSegment } from '../../../../lib/api/studentAdminReportApi';

const t = {
  filters: {
    classLabel: 'Lớp',
    termLabel: 'Khóa',
    allClasses: 'Tất cả các lớp',
    allTerms: 'Tất cả các khóa',
    termOption: 'Khóa {index} ({start} – {end})',
    termOptionOpen: 'Khóa {index} (từ {start})',
    termOptionCurrent: 'Khóa {index} ({start} – {end}) · đang học',
    termUnknown: 'Khóa khác',
    classUnknown: 'Lớp không xác định ({id})',
    dateFrom: 'Từ ngày',
    dateTo: 'Đến ngày',
    clearDates: 'Xóa lọc ngày',
    ongoing: 'nay',
  },
};

function segment(over: Partial<StudentTimelineSegment>): StudentTimelineSegment {
  return {
    key: 'cls-3b::term_1',
    classId: 'cls-3b',
    className: 'Lớp 3B',
    classMissing: false,
    grade: 3,
    attendanceMode: 'marked_only',
    term: {
      termId: 'term_1',
      classId: 'cls-3b',
      index: 1,
      startDate: '2025-09-01',
      endDate: '2025-12-31',
      isCurrent: false,
      schedule: null,
    },
    ...over,
  } as StudentTimelineSegment;
}

const TIMELINE: StudentTimelineSegment[] = [
  segment({}),
  segment({
    key: 'cls-4a::current',
    classId: 'cls-4a',
    className: 'Lớp 4A',
    grade: 4,
    attendanceMode: 'expected',
    term: {
      termId: 'current',
      classId: 'cls-4a',
      index: 1,
      startDate: '2026-01-01',
      endDate: '',
      isCurrent: true,
      schedule: null,
    },
  }),
];

describe('StudentReportFilters', () => {
  it('lists only the selected class courses, keyed by termKey', () => {
    render(
      <StudentReportFilters
        timeline={TIMELINE}
        filter={{ classId: 'cls-4a', termKey: ALL }}
        onChange={vi.fn()}
        t={t}
      />
    );

    const termSelect = screen.getByTestId('filter-term') as HTMLSelectElement;
    const values = [...termSelect.options].map((o) => o.value);

    expect(values).toEqual([ALL, 'cls-4a::current']);
  });

  it('uses distinct option values when every class has a current course', () => {
    const twoCurrents = [
      TIMELINE[1],
      { ...TIMELINE[1], key: 'cls-5c::current', classId: 'cls-5c', className: 'Lớp 5C' },
    ];
    render(
      <StudentReportFilters
        timeline={twoCurrents}
        filter={{ classId: ALL, termKey: ALL }}
        onChange={vi.fn()}
        t={t}
      />
    );

    const termSelect = screen.getByTestId('filter-term') as HTMLSelectElement;
    const values = [...termSelect.options].map((o) => o.value);

    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual([ALL, 'cls-4a::current', 'cls-5c::current']);
  });

  it('resets the course to ALL when the class changes', () => {
    const onChange = vi.fn();
    render(
      <StudentReportFilters
        timeline={TIMELINE}
        filter={{ classId: 'cls-3b', termKey: 'cls-3b::term_1' }}
        onChange={onChange}
        t={t}
      />
    );

    fireEvent.change(screen.getByTestId('filter-class'), { target: { value: 'cls-4a' } });

    expect(onChange).toHaveBeenCalledWith({ classId: 'cls-4a', termKey: ALL });
  });

  it('emits the chosen course', () => {
    const onChange = vi.fn();
    render(
      <StudentReportFilters
        timeline={TIMELINE}
        filter={{ classId: 'cls-3b', termKey: ALL }}
        onChange={onChange}
        t={t}
      />
    );

    fireEvent.change(screen.getByTestId('filter-term'), { target: { value: 'cls-3b::term_1' } });

    expect(onChange).toHaveBeenCalledWith({ classId: 'cls-3b', termKey: 'cls-3b::term_1' });
  });

  it('emits a date range', () => {
    const onChange = vi.fn();
    render(
      <StudentReportFilters
        timeline={TIMELINE}
        filter={{ classId: ALL, termKey: ALL }}
        onChange={onChange}
        t={t}
      />
    );

    fireEvent.change(screen.getByTestId('filter-from'), { target: { value: '2026-01-01' } });

    expect(onChange).toHaveBeenCalledWith({ classId: ALL, termKey: ALL, from: '2026-01-01' });
  });
});
