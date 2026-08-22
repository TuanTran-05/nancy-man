// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingStudentSummary } from '../../../../shared/accountingStudentFinance';
import { fetchAllAccountingStudentFinance } from '../../../lib/api/accountingStudentFinanceApi';
import { fetchStudentAdminReport } from '../../../lib/api/studentAdminReportApi';
import type { Class } from '../../../types';
import { StudentFinanceWorkspace } from './StudentFinanceWorkspace';

vi.mock('../../../lib/api/accountingStudentFinanceApi', () => ({
  ACCOUNTING_STUDENT_FINANCE_ROW_CAP: 3000,
  fetchAllAccountingStudentFinance: vi.fn(),
}));

vi.mock('../../../lib/api/studentAdminReportApi', () => ({
  fetchStudentAdminReport: vi.fn(),
}));

vi.mock('../../../lib/api/classAdminApi', () => ({
  generateCourseFeeLedgersForEnrollments: vi.fn(),
}));

vi.mock('../../../hooks/useInvalidationRefresh', () => ({
  useInvalidationRefresh: vi.fn(),
}));

const row = {
  studentId: 's1',
  studentName: 'Nguyễn An',
  studentNameNormalized: 'nguyen an',
  studentCode: 'HS001',
  searchTokens: [],
  studentLifecycle: 'enrolled',
  currentClassId: 'c1',
  currentEnrollmentId: 'e1',
  currentEnrollmentStatus: 'active',
  currentCoursePaymentStatus: 'unpaid',
  classCount: 1,
  courseCount: 1,
  totalPaid: 0,
  totalOutstanding: 900_000,
  overdueCourseCount: 0,
  priorityRank: 1,
  sourceVersion: 1,
  rebuiltAt: '2026-07-29T00:00:00.000Z',
} as AccountingStudentSummary;

describe('StudentFinanceWorkspace student profile access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValue({
      rows: [row],
      dataIncomplete: false,
      truncated: false,
    });
  });

  it('links the student name to the finance profile in a new browser tab', async () => {
    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    const link = await screen.findByRole('link', { name: /Nguyễn An/ });
    expect(link).toHaveAttribute('href', '/students/s1?tab=finance');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the current class name with its class code underneath', async () => {
    const currentClass = {
      id: 'c1',
      name: 'CSE 301',
      teacherId: 't1',
    } as Class;

    render(
      <StudentFinanceWorkspace
        active
        classes={[currentClass]}
        teachers={[{ uid: 't1', displayName: 'Cô Lan' }]}
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    expect(await screen.findByText('CSE 301 - Cô Lan')).toBeInTheDocument();
    expect(screen.getByText('c1')).toHaveClass('text-xs', 'text-slate-500');
  });

  it('keeps the class code visible when its friendly name cannot be resolved', async () => {
    render(
      <StudentFinanceWorkspace
        active
        classes={[]}
        teachers={[]}
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    expect(await screen.findByText('Không xác định')).toBeInTheDocument();
    expect(screen.getByText('c1')).toHaveClass('text-xs', 'text-slate-500');
  });

  it('uses the displayed class code in the class filter', async () => {
    render(
      <StudentFinanceWorkspace
        active
        classes={[{ id: 'c1', name: 'CSE 301', teacherId: 't1' } as Class]}
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    fireEvent.change(await screen.findByPlaceholderText('Lọc theo mã lớp'), {
      target: { value: 'c1' },
    });

    await waitFor(() =>
      expect(fetchAllAccountingStudentFinance).toHaveBeenLastCalledWith(
        expect.objectContaining({ classId: 'c1' })
      )
    );
  });

  it('shows a safe fallback when the student has no current class', async () => {
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValueOnce({
      rows: [{ ...row, currentClassId: '' }],
      dataIncomplete: false,
      truncated: false,
    });

    render(
      <StudentFinanceWorkspace
        active
        classes={[]}
        teachers={[]}
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    expect(await screen.findByText('Không xác định')).toBeInTheDocument();
  });

  it('keeps profile access on the student name and restores the tuition reminder action', async () => {
    const user = userEvent.setup();
    const onSendTuitionReminder = vi.fn();

    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={onSendTuitionReminder}
      />
    );

    const profileLinks = await screen.findAllByRole('link', { name: /Nguyễn An/ });
    expect(profileLinks).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nhắc học phí cho Nguyễn An' }));
    expect(onSendTuitionReminder).toHaveBeenCalledWith(row);
  });

  it('starts collection for the exact row and opens center-wide receipt history', async () => {
    const user = userEvent.setup();
    const onCollectPayment = vi.fn();
    const onOpenReceiptHistory = vi.fn();

    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={onCollectPayment}
        onOpenReceiptHistory={onOpenReceiptHistory}
        onSendTuitionReminder={vi.fn()}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'Thu tiền cho Nguyễn An' }));
    expect(onCollectPayment).toHaveBeenCalledWith(row);

    await user.click(screen.getByRole('button', { name: 'Lịch sử thu' }));
    expect(onOpenReceiptHistory).toHaveBeenCalledOnce();
  });

  it('disables reminder when the row has no debt', async () => {
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValueOnce({
      rows: [{ ...row, studentId: 'paid', studentName: 'Đã đóng', totalOutstanding: 0 }],
      dataIncomplete: false,
      truncated: false,
    });

    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    expect(await screen.findByRole('button', { name: 'Nhắc học phí cho Đã đóng' })).toBeDisabled();
  });

  it('disables only the student row whose reminder is being sent', async () => {
    render(
      <StudentFinanceWorkspace
        active
        reminderLoadingStudentIds={['s1']}
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    expect(
      await screen.findByRole('button', { name: 'Đang nhắc học phí cho Nguyễn An' })
    ).toBeDisabled();
  });
});

describe('StudentFinanceWorkspace search box', () => {
  const students = [
    {
      ...row,
      studentId: 's1',
      studentName: 'Nguyễn Văn An',
      studentNameNormalized: 'nguyen van an',
      studentCode: 'HS001',
    },
    {
      ...row,
      studentId: 's2',
      studentName: 'Nguyễn Thị Bình',
      studentNameNormalized: 'nguyen thi binh',
      studentCode: 'HS002',
    },
    {
      ...row,
      studentId: 's3',
      studentName: 'Trần Văn An',
      studentNameNormalized: 'tran van an',
      studentCode: 'HS003',
    },
  ] as AccountingStudentSummary[];

  beforeEach(() => {
    vi.clearAllMocks();
    // The workspace restores its search box from the URL, so each test starts clean.
    window.history.replaceState({}, '', '/tuition?tab=students');
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValue({
      rows: students,
      dataIncomplete: false,
      truncated: false,
    });
  });

  function renderWorkspace() {
    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );
    return screen.findByPlaceholderText('Tìm học sinh theo tên hoặc mã');
  }

  const shownNames = () => screen.getAllByRole('link').map((link) => link.textContent?.trim());

  it('loads the whole list once and filters it without asking the server again', async () => {
    const user = userEvent.setup();
    const input = await renderWorkspace();
    await screen.findByRole('link', { name: 'Nguyễn Văn An' });
    expect(fetchAllAccountingStudentFinance).toHaveBeenCalledTimes(1);

    await user.type(input, 'nguyen van an');

    await waitFor(() => expect(shownNames()).toEqual(['Nguyễn Văn An']));
    expect(fetchAllAccountingStudentFinance).toHaveBeenCalledTimes(1);
  });

  it('narrows the list from the very first character typed', async () => {
    const user = userEvent.setup();
    const input = await renderWorkspace();
    await screen.findByRole('link', { name: 'Nguyễn Văn An' });

    await user.type(input, 'b');
    await waitFor(() => expect(shownNames()).toEqual(['Nguyễn Thị Bình']));
  });

  it('matches the middle of a word the way the student directory does', async () => {
    const user = userEvent.setup();
    const input = await renderWorkspace();
    await screen.findByRole('link', { name: 'Nguyễn Văn An' });

    await user.type(input, 'uyen');
    await waitFor(() => expect(shownNames()).toEqual(['Nguyễn Văn An', 'Nguyễn Thị Bình']));
  });

  it('finds the student when a full name is pasted with diacritics', async () => {
    const user = userEvent.setup();
    const input = await renderWorkspace();
    await screen.findByRole('link', { name: 'Nguyễn Văn An' });

    await user.click(input);
    await user.paste('Trần Văn An');

    await waitFor(() => expect(shownNames()).toEqual(['Trần Văn An']));
  });

  it('tells the accountant when a pasted name matches nobody', async () => {
    const user = userEvent.setup();
    const input = await renderWorkspace();
    await screen.findByRole('link', { name: 'Nguyễn Văn An' });

    await user.click(input);
    await user.paste('Lê Văn Cường');

    expect(await screen.findByText('Không có học sinh phù hợp.')).toBeInTheDocument();
  });

  it('pages long results client-side and keeps every match reachable', async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...row,
      studentId: `s${index}`,
      studentName: `Học sinh ${index}`,
      studentNameNormalized: `hoc sinh ${index}`,
      studentCode: `HS${index}`,
    })) as AccountingStudentSummary[];
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValue({
      rows: many,
      dataIncomplete: false,
      truncated: false,
    });

    await renderWorkspace();
    await screen.findByRole('link', { name: 'Học sinh 0' });
    expect(shownNames()).toHaveLength(50);

    fireEvent.click(screen.getByRole('button', { name: /Tải thêm|Load more/i }));

    await waitFor(() => expect(shownNames()).toHaveLength(60));
  });

  it('warns that the list was cut short at the row cap', async () => {
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValue({
      rows: students,
      dataIncomplete: false,
      truncated: true,
    });

    await renderWorkspace();

    expect(await screen.findByText(/đã bị cắt bớt/)).toBeInTheDocument();
  });
});

describe('StudentFinanceWorkspace bulk ledger entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValue({
      rows: [row],
      dataIncomplete: false,
      truncated: false,
    });
  });

  it('exposes exactly one ledger generation control', async () => {
    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
        onGenerateLedgers={vi.fn()}
      />
    );

    await screen.findByRole('link', { name: /Nguyễn An/ });
    expect(screen.getAllByRole('button', { name: /^Tạo công nợ$/i })).toHaveLength(1);
    expect(screen.queryByText(/Tạo học phí theo lớp/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tạo học phí toàn bộ/i)).not.toBeInTheDocument();
  });

  it('calls the handler when the single button is pressed', async () => {
    const onGenerateLedgers = vi.fn();
    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
        onGenerateLedgers={onGenerateLedgers}
      />
    );

    await screen.findByRole('link', { name: /Nguyễn An/ });
    await userEvent.click(screen.getByRole('button', { name: /^Tạo công nợ$/i }));
    expect(onGenerateLedgers).toHaveBeenCalledTimes(1);
  });
});

describe('StudentFinanceWorkspace ledgers without an enrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValue({
      rows: [row],
      dataIncomplete: false,
      truncated: false,
    });
  });

  /**
   * Ledgers predating the enrollment collection have no enrollment row, so the
   * course table is empty while the list still shows their debt. Showing only
   * "Chưa có enrollment" next to a non-zero balance is what sent accounting
   * looking for money the page had already been told about.
   */
  it('shows a ledger the course summaries do not cover', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue({
      student: {},
      timeline: [],
      attendanceRows: [],
      sessionValueByTerm: {},
      receipts: [],
      courseSummaries: [],
      ledgers: [
        {
          id: 'ledger-1',
          periodKey: '2026-06-07',
          classId: 'c9',
          className: 'G9 - Mr. Anh Tuan',
          termKey: null,
          termStart: '2026-06-07',
          termEnd: '2026-08-01',
          termLabel: null,
          dueDate: '2026-06-17',
          grossAmount: 1_400_000,
          discount: 0,
          netAmount: 1_400_000,
          paid: 0,
          outstanding: 1_400_000,
          displayStatus: 'overdue',
          isOverdue: true,
          hasDueDate: true,
        },
      ],
      truncation: { attendance: false, ledgers: false, classSessions: false },
      generatedAt: '2026-08-05T00:00:00.000Z',
    } as never);

    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    await screen.findByRole('link', { name: /Nguyễn An/ });
    await userEvent.click(screen.getByRole('button', { name: 'Mở rộng' }));

    expect(await screen.findByText(/G9 - Mr\. Anh Tuan/)).toBeInTheDocument();
    expect(screen.getAllByText(/1\.400\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Không có enrollment')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có enrollment.')).not.toBeInTheDocument();
  });
});

describe('StudentFinanceWorkspace deep link from class reconciliation', () => {
  const DEEP_LINK =
    '/tuition?tab=students&studentLifecycleScope=all&studentClassId=c1&studentExpandedId=s60';

  function classCohort(size: number): AccountingStudentSummary[] {
    return Array.from({ length: size }, (_, index) => {
      const ordinal = index + 1;
      return {
        ...row,
        studentId: `s${ordinal}`,
        studentName: `Học viên ${ordinal}`,
        studentNameNormalized: `hoc vien ${ordinal}`,
        studentCode: `HS${String(ordinal).padStart(3, '0')}`,
        // the historical cohort mixes lifecycles, so class filtering alone cannot
        // guarantee the target lands inside the first rendered page
        studentLifecycle: ordinal % 2 === 0 ? 'completed' : 'enrolled',
        currentEnrollmentStatus: ordinal % 2 === 0 ? 'completed' : 'active',
      } as AccountingStudentSummary;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', DEEP_LINK);
    vi.mocked(fetchAllAccountingStudentFinance).mockResolvedValue({
      rows: classCohort(60),
      dataIncomplete: false,
      truncated: false,
    });
    vi.mocked(fetchStudentAdminReport).mockResolvedValue({
      courseSummaries: [],
      ledgers: [],
      truncation: { attendance: false, ledgers: false, classSessions: false },
      generatedAt: '2026-08-14T00:00:00.000Z',
    } as never);
  });

  it('loads the linked student detail without a manual click', async () => {
    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    await waitFor(() => expect(fetchStudentAdminReport).toHaveBeenCalledWith({ studentId: 's60' }));
  });

  it('pins a linked target that falls outside the first rendered page', async () => {
    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    // row 60 of 60 is past the 50-row page, yet the deep link must still show it
    expect(await screen.findByRole('link', { name: /Học viên 60/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Học viên 55/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Chưa có enrollment.')).toBeInTheDocument();
  });

  it('releases the pin when the row is collapsed again', async () => {
    render(
      <StudentFinanceWorkspace
        active
        onCollectPayment={vi.fn()}
        onOpenReceiptHistory={vi.fn()}
        onSendTuitionReminder={vi.fn()}
      />
    );

    await screen.findByRole('link', { name: /Học viên 60/ });
    await userEvent.click(screen.getAllByRole('button', { name: 'Thu gọn' })[0]);

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Học viên 60/ })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('link', { name: /Học viên 1$/ })).toBeInTheDocument();
  });
});
