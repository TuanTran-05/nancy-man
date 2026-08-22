// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ClassTuitionReconciliationView } from './ClassTuitionReconciliationView';
import { translations } from '../../../../lib/i18n/translations';
import type { ClassTuitionReconciliationText } from './types';
import {
  buildClassTuitionReconciliation,
  type ClassReconciliationCourseOption,
} from '../../../../../shared/classTuitionReconciliation';

const t = translations.vi.adminFinanceReport.classReconciliation as ClassTuitionReconciliationText;

describe('ClassTuitionReconciliationView domain contract', () => {
  const course: ClassReconciliationCourseOption = {
    key: 'c1:2026-06-01',
    courseId: null,
    termStart: '2026-06-01',
    termEnd: null,
    label: 'Khoa 2026-06-01',
    isCurrent: true,
    warnings: [],
    tuitionFee: 2_000_000,
    tuitionFeeSource: 'class_current',
  };

  const report = buildClassTuitionReconciliation({
    classId: 'c1',
    className: 'Lop 1',
    course,
    enrollments: [
      {
        id: 'e1',
        classId: 'c1',
        studentId: 'st1',
        termStart: '2026-06-01',
        status: 'active',
        joinedAt: '2026-06-01',
      },
      {
        id: 'e2',
        classId: 'c1',
        studentId: 'st2',
        termStart: '2026-06-01',
        status: 'completed',
        joinedAt: '2026-06-01',
      },
    ],
    ledgers: [
      {
        id: 'l1',
        classId: 'c1',
        studentId: 'st1',
        termStart: '2026-06-01',
        amount: 2_000_000,
        discountTotal: 0,
        paidTotal: 500_000,
      },
      {
        id: 'l9',
        classId: 'c1',
        termStart: '2026-06-01',
        amount: 1_000_000,
        discountTotal: 0,
        paidTotal: 1_000_000,
      },
    ],
    students: [{ id: 'st1', fullName: 'Nguyen Van A', studentCode: 'HV001' }],
  });

  it('renders student, missing-ledger and orphan rows straight from the domain module', () => {
    render(
      <ClassTuitionReconciliationView
        report={report}
        search=""
        filter="all"
        language="vi"
        t={t}
        onSearchChange={vi.fn()}
        onFilterChange={vi.fn()}
        onViewDetails={vi.fn()}
      />
    );

    expect(report.rows).toHaveLength(3);
    expect(screen.getAllByTestId(/^student-name-/)).toHaveLength(3);
    expect(screen.getAllByText('Nguyen Van A').length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${t.orphanLedger}: l9`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.unknownStudent).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.warningLabels.missing_ledger).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.warningLabels.ledger_student_missing).length).toBeGreaterThan(0);
  });
});
