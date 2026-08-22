// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ClassTuitionReconciliationView } from './ClassTuitionReconciliationView';
import { translations } from '../../../../lib/i18n/translations';
import type { ClassTuitionReconciliationText } from './types';
import type {
  ClassTuitionReconciliationResponse,
  ClassTuitionStudentRow,
} from '../../../../../shared/classTuitionReconciliation';

const t = translations.vi.adminFinanceReport.classReconciliation as ClassTuitionReconciliationText;

function row(overrides: Partial<ClassTuitionStudentRow> = {}): ClassTuitionStudentRow {
  return {
    key: 'student:st1',
    kind: 'student',
    studentId: 'st1',
    fullName: 'Nguyễn Văn An',
    studentCode: 'HV001',
    studentRecordFound: true,
    enrollmentIds: ['e1'],
    enrollmentStatuses: ['active'],
    ledgerIds: ['l1'],
    chargeable: true,
    expectedGross: 2_000_000,
    recordedGross: 2_000_000,
    reductionTotal: 0,
    netDueTotal: 2_000_000,
    paidTotal: 500_000,
    outstandingTotal: 1_500_000,
    overpaidTotal: 0,
    warnings: [],
    ...overrides,
  };
}

function report(
  overrides: Partial<ClassTuitionReconciliationResponse> = {}
): ClassTuitionReconciliationResponse {
  return {
    success: true,
    scope: {
      classId: 'c1',
      className: 'Tiếng Anh 1A',
      courseId: null,
      termStart: '2026-06-01',
      termEnd: '2026-08-31',
      courseLabel: 'Khóa Hè 2026',
    },
    tuitionFee: { amount: 2_000_000, source: 'class_current' },
    summary: {
      expectedGross: 4_000_000,
      recordedGross: 2_000_000,
      reductionTotal: 0,
      netDueTotal: 2_000_000,
      paidTotal: 500_000,
      outstandingTotal: 1_500_000,
      overpaidTotal: 0,
      studentCount: 2,
      unidentifiedLedgerCount: 0,
      missingLedgerCount: 1,
      warningRowCount: 1,
    },
    rows: [row()],
    warnings: [],
    ...overrides,
  };
}

function renderView(
  props: Partial<React.ComponentProps<typeof ClassTuitionReconciliationView>> = {}
) {
  const onSearchChange = vi.fn();
  const onFilterChange = vi.fn();
  const onViewDetails = vi.fn();
  const utils = render(
    <ClassTuitionReconciliationView
      report={report()}
      search=""
      filter="all"
      language="vi"
      t={t}
      onSearchChange={onSearchChange}
      onFilterChange={onFilterChange}
      onViewDetails={onViewDetails}
      {...props}
    />
  );
  return { ...utils, onSearchChange, onFilterChange, onViewDetails };
}

describe('ClassTuitionReconciliationView KPIs', () => {
  it('renders the six core money KPIs from the response without recomputing them', () => {
    renderView();
    const kpis = screen.getByTestId('class-reconciliation-kpis');

    expect(within(kpis).getByText(t.kpis.expectedGross)).toBeTruthy();
    expect(within(kpis).getByText('4.000.000 đ')).toBeTruthy();
    expect(within(kpis).getByText(t.kpis.recordedGross)).toBeTruthy();
    expect(within(kpis).getByText(t.kpis.reductionTotal)).toBeTruthy();
    expect(within(kpis).getByText(t.kpis.netDueTotal)).toBeTruthy();
    expect(within(kpis).getByText(t.kpis.paidTotal)).toBeTruthy();
    expect(within(kpis).getByText('500.000 đ')).toBeTruthy();
    expect(within(kpis).getByText(t.kpis.outstandingTotal)).toBeTruthy();
    expect(within(kpis).getByText('1.500.000 đ')).toBeTruthy();
  });

  it('renders missingLedgerCount and warningRowCount counters', () => {
    renderView();
    const kpis = screen.getByTestId('class-reconciliation-kpis');

    expect(within(kpis).getByText(t.kpis.missingLedgerCount)).toBeTruthy();
    expect(within(kpis).getByText(t.kpis.warningRowCount)).toBeTruthy();
  });

  it('hides the overpaid KPI at zero and shows it above zero', () => {
    const { unmount } = renderView();
    expect(screen.queryByText(t.kpis.overpaidTotal)).toBeNull();
    unmount();

    renderView({
      report: report({
        summary: { ...report().summary, overpaidTotal: 250_000 },
      }),
    });
    expect(screen.getByText(t.kpis.overpaidTotal)).toBeTruthy();
    expect(screen.getByText('250.000 đ')).toBeTruthy();
  });

  it('shows incompleteData for a null metric while independent metrics still render', () => {
    renderView({
      report: report({
        summary: {
          ...report().summary,
          expectedGross: null,
          recordedGross: null,
          paidTotal: 500_000,
        },
      }),
    });
    const kpis = screen.getByTestId('class-reconciliation-kpis');

    expect(within(kpis).getAllByText(t.incompleteData).length).toBeGreaterThanOrEqual(2);
    expect(within(kpis).getByText('500.000 đ')).toBeTruthy();
  });

  it('renders a real zero total as money, never as incompleteData', () => {
    renderView({
      report: report({
        summary: { ...report().summary, reductionTotal: 300_000, outstandingTotal: 0 },
      }),
    });
    const kpis = screen.getByTestId('class-reconciliation-kpis');

    expect(within(kpis).getByText('0 đ')).toBeTruthy();
    expect(within(kpis).queryByText(t.incompleteData)).toBeNull();
  });

  it('lays the KPI grid out in two columns on mobile', () => {
    renderView();
    expect(screen.getByTestId('class-reconciliation-kpis').className).toContain('grid-cols-2');
  });

  it('labels the block as whole-course scope, independent of the month filter', () => {
    renderView();
    expect(screen.getByText(t.wholeCourseScope)).toBeTruthy();
  });
});

describe('ClassTuitionReconciliationView rows and filters', () => {
  it('renders every desktop column header', () => {
    renderView();
    const table = screen.getByRole('table');

    for (const label of [
      t.columns.student,
      t.columns.enrollment,
      t.columns.gross,
      t.columns.reduction,
      t.columns.netDue,
      t.columns.paid,
      t.columns.outstanding,
      t.columns.warnings,
    ]) {
      expect(within(table).getByText(label)).toBeTruthy();
    }
    expect(within(table).getByText(t.columns.actions)).toBeTruthy();
  });

  it('keeps the desktop table and mobile cards on complementary breakpoints', () => {
    renderView();
    const desktop = screen.getByTestId('class-reconciliation-table');
    const mobile = screen.getByTestId('class-reconciliation-cards');

    expect(desktop.className).toContain('hidden');
    expect(desktop.className).toContain('md:block');
    expect(mobile.className).toContain('md:hidden');
  });

  it('never wraps the desktop table in a horizontal scroll container', () => {
    const { container } = renderView();
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
  });

  it('renders the full money set on mobile cards too', () => {
    renderView();
    const cards = screen.getByTestId('class-reconciliation-cards');

    // gross and net due are both 2.000.000 on this fixture row
    expect(within(cards).getAllByText('2.000.000 đ')).toHaveLength(2);
    expect(within(cards).getByText('500.000 đ')).toBeTruthy();
    expect(within(cards).getByText('1.500.000 đ')).toBeTruthy();
    expect(within(cards).getByText('0 đ')).toBeTruthy();
  });

  it('shows recordedGross when the row has a ledger', () => {
    renderView();
    const cell = screen.getByTestId('gross-student:st1');

    expect(cell.textContent).toContain('2.000.000 đ');
    expect(cell.textContent).not.toContain(t.expectedBadge);
  });

  it('shows expectedGross with the projected badge when the ledger is missing', () => {
    renderView({
      report: report({
        rows: [
          row({
            ledgerIds: [],
            recordedGross: null,
            reductionTotal: null,
            netDueTotal: null,
            paidTotal: null,
            outstandingTotal: null,
            overpaidTotal: null,
            warnings: ['missing_ledger'],
          }),
        ],
      }),
    });
    const cell = screen.getByTestId('gross-student:st1');

    expect(cell.textContent).toContain('2.000.000 đ');
    expect(cell.textContent).toContain(t.expectedBadge);
  });

  it('shows an em dash when the row is neither recorded nor chargeable at a known fee', () => {
    renderView({
      report: report({
        rows: [
          row({
            ledgerIds: [],
            chargeable: false,
            expectedGross: null,
            recordedGross: null,
            warnings: ['tuition_review_required'],
          }),
        ],
      }),
    });

    expect(screen.getByTestId('gross-student:st1').textContent).toContain('—');
  });

  it('renders every warning with readable text and an accessible label', () => {
    renderView({
      report: report({
        rows: [row({ warnings: ['duplicate_ledger', 'ledger_fee_mismatch'] })],
      }),
    });

    expect(screen.getAllByText(t.warningLabels.duplicate_ledger).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.warningLabels.ledger_fee_mismatch).length).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText(`${t.columns.warnings}: ${t.warningLabels.duplicate_ledger}`).length
    ).toBeGreaterThan(0);
  });

  it('identifies an orphan ledger row by its ledger id', () => {
    renderView({
      report: report({
        rows: [
          row({
            key: 'orphan_ledger:l9',
            kind: 'orphan_ledger',
            studentId: null,
            fullName: '',
            studentCode: '',
            studentRecordFound: false,
            enrollmentIds: [],
            enrollmentStatuses: [],
            ledgerIds: ['l9'],
            chargeable: false,
            expectedGross: null,
            warnings: ['ledger_student_missing'],
          }),
        ],
      }),
    });

    expect(screen.getAllByText(`${t.orphanLedger}: l9`).length).toBeGreaterThan(0);
  });

  it('translates the enrollment status instead of leaking the raw code', () => {
    renderView();
    expect(screen.getAllByText(t.statusLabels.active).length).toBeGreaterThan(0);
    expect(screen.queryByText('active')).toBeNull();
  });

  it('reports search input up to the controller', async () => {
    const user = userEvent.setup();
    const { onSearchChange } = renderView();

    await user.type(screen.getByLabelText(t.studentSearch), 'an');
    expect(onSearchChange).toHaveBeenCalled();
  });

  it('offers all five quick filters and reports the chosen one', async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderView();
    const group = screen.getByRole('group', { name: t.title });

    expect(within(group).getAllByRole('button')).toHaveLength(5);
    expect(
      within(group).getByRole('button', { name: t.filters.all }).getAttribute('aria-pressed')
    ).toBe('true');

    await user.click(within(group).getByRole('button', { name: t.filters.outstanding }));
    expect(onFilterChange).toHaveBeenCalledWith('outstanding');
  });

  it('delegates filtering and ordering to the shared domain helper', () => {
    renderView({
      filter: 'warnings',
      report: report({
        rows: [
          row({ key: 'student:a', studentId: 'a', fullName: 'An', warnings: [] }),
          row({ key: 'student:b', studentId: 'b', fullName: 'Bình', warnings: ['overpaid'] }),
        ],
      }),
    });

    const names = screen.getAllByTestId(/^student-name-/).map((node) => node.textContent);
    expect(names).toEqual(['Bình']);
  });

  it('shows the empty-filter message when nothing matches', () => {
    renderView({ search: 'zzzz' });
    expect(screen.getByText(t.noMatches)).toBeTruthy();
  });

  it('shows the empty-report message when the course has no rows at all', () => {
    renderView({ report: report({ rows: [] }) });
    expect(screen.getByText(t.noRows)).toBeTruthy();
  });

  it('opens details for the clicked row with an accessible name', async () => {
    const user = userEvent.setup();
    const { onViewDetails } = renderView();

    await user.click(screen.getAllByRole('button', { name: `${t.viewDetails}: Nguyễn Văn An` })[0]);
    expect(onViewDetails).toHaveBeenCalledWith(expect.objectContaining({ key: 'student:st1' }));
  });
});
