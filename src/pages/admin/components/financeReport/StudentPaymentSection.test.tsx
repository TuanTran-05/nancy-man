// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';
import type { StudentPaymentsText } from './types';
import { StudentPaymentSection } from './StudentPaymentSection';

const t: StudentPaymentsText = {
  statusLabels: {
    paid: 'Paid in full',
    partial: 'Partially paid',
    unpaid: 'Not paid',
    waived: 'Waived',
  },
  students: {
    title: 'Student tuition reconciliation',
    subtitle: 'Student counts and tuition collection status for the selected month',
    totalStudents: 'Students with tuition',
    paidStudents: 'Paid in full',
    withOutstanding: 'With outstanding balance',
    unpaidStudents: 'Not paid',
    overdueStudents: 'students with overdue balances',
    all: 'All',
    search: 'Search students',
    searchPlaceholder: 'Search by name, student ID or phone number',
    noMatches: 'No students match the current filters.',
    student: 'Student',
    fullName: 'Full name',
    studentCode: 'Student ID',
    dateOfBirth: 'Date of birth',
    phone: 'Phone number',
    course: 'Course',
    className: 'Class',
    teacher: 'Teacher',
    courseDetails: 'Tuition details by course',
    moreCourses: 'more courses',
    status: 'Status',
    billedAmount: 'Tuition due',
    paidAmount: 'Amount paid',
    outstandingAmount: 'Amount outstanding',
    overdueAmount: 'Overdue amount',
    overdue: 'Has overdue balance',
    ledgerCount: 'Tuition items',
    actions: 'Actions',
    viewDetails: 'View details',
    detailTitle: 'Student tuition details',
    close: 'Close',
    unknownStudent: 'Student record not found',
    notAvailable: 'Not available',
    page: 'Page',
    previousPage: 'Previous page',
    nextPage: 'Next page',
  },
};

const report: CenterFinanceReport = {
  success: true,
  selectedMonth: '2026-04',
  months: [],
  current: {
    month: '2026-04',
    grossBilled: 3_000_000,
    discountTotal: 0,
    netBilled: 3_000_000,
    collectedCohort: 500_000,
    outstanding: 2_500_000,
    cashIn: 500_000,
    cashOut: 0,
  },
  discountBreakdown: { discount: 0, waiver: 0, unclassified: 0 },
  incomeByLevel: [],
  expensesByCategory: [],
  receivablesByStatus: [],
  studentPayments: {
    summary: {
      total: 2,
      paid: 0,
      partial: 1,
      unpaid: 1,
      waived: 0,
      withOutstanding: 2,
      overdue: 1,
    },
    rows: [
      {
        id: 's1',
        fullName: 'Nguyen An',
        studentCode: 'HS001',
        dateOfBirth: '2012-02-03',
        phone: '0901234567',
        paymentStatus: 'partial',
        billedAmount: 1_000_000,
        paidAmount: 500_000,
        outstandingAmount: 500_000,
        overdueAmount: 500_000,
        ledgerCount: 2,
        courses: [
          {
            id: 'course-1',
            courseLabel: '',
            termStart: '2026-07-17',
            termEnd: '2026-09-17',
            classId: 'class-1',
            className: 'IELTS 6.5',
            teacherId: 'teacher-1',
            teacherName: 'Ms. Lan',
            paymentStatus: 'partial',
            billedAmount: 1_000_000,
            paidAmount: 500_000,
            outstandingAmount: 500_000,
            overdueAmount: 500_000,
          },
        ],
        studentRecordFound: true,
      },
      {
        id: 's2',
        fullName: 'Le Binh',
        studentCode: 'HS002',
        dateOfBirth: '2011-06-07',
        phone: '0907654321',
        paymentStatus: 'unpaid',
        billedAmount: 2_000_000,
        paidAmount: 0,
        outstandingAmount: 2_000_000,
        overdueAmount: 0,
        ledgerCount: 1,
        courses: [
          {
            id: 'course-2',
            courseLabel: '',
            termStart: '2026-09-20',
            termEnd: '2026-11-20',
            classId: 'class-2',
            className: 'Cambridge B1',
            teacherId: 'teacher-2',
            teacherName: 'Mr. Minh',
            paymentStatus: 'unpaid',
            billedAmount: 2_000_000,
            paidAmount: 0,
            outstandingAmount: 2_000_000,
            overdueAmount: 0,
          },
        ],
        studentRecordFound: true,
      },
    ],
  },
  source: 'live',
};

describe('StudentPaymentSection', () => {
  it('filters students and opens complete student finance details', async () => {
    render(<StudentPaymentSection report={report} t={t} language="en" />);

    expect(screen.getByText('Student tuition reconciliation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Students with tuition/ })).toHaveTextContent('2');

    fireEvent.click(screen.getByLabelText('View details: Nguyen An'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('Nguyen An').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText('HS001')).toBeInTheDocument();
    expect(within(dialog).getByText('03/02/2012')).toBeInTheDocument();
    expect(within(dialog).getByText('0901234567')).toBeInTheDocument();
    expect(within(dialog).getByText('17/07/2026 - 17/09/2026')).toBeInTheDocument();
    expect(within(dialog).getByText('IELTS 6.5')).toBeInTheDocument();
    expect(within(dialog).getByText('Ms. Lan')).toBeInTheDocument();
    expect(within(dialog).getAllByText('500,000 đ')).toHaveLength(4);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'HS002' } });
    expect(screen.getAllByText('Le Binh').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Nguyen An')).not.toBeInTheDocument();
  });
});
