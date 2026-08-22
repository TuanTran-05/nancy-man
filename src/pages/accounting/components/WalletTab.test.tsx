// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Class } from '../../../types';
import {
  allocateStudentWallet,
  fetchWalletBalances,
  fetchWalletStudentContext,
  fetchWalletTransactions,
  voidWalletTransaction,
} from '../../../lib/api/financeApi';
import { WalletTab } from './WalletTab';

vi.mock('../../../lib/api/financeApi', () => ({
  allocateStudentWallet: vi.fn(),
  fetchWalletBalances: vi.fn(),
  fetchWalletStudentContext: vi.fn(),
  fetchWalletTransactions: vi.fn(),
  voidWalletTransaction: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const walletClasses = [
  {
    id: 'c1',
    name: 'A1',
    teacherId: 't1',
    schedule: '',
    daysOfWeek: [],
    description: '',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
  },
] as unknown as Class[];

const t = {
  financePage: {
    walletEmpty: 'Không có học sinh phù hợp',
    walletTxDeposit: 'Nạp ví',
    walletTxAllocation: 'Cấn công nợ',
    walletTxCredit: 'Cộng ví',
    walletTxRefund: 'Hoàn tiền',
    walletTxAdjustment: 'Điều chỉnh',
    walletTxVoided: 'Đã hủy',
  },
  common: { close: 'Đóng', cancel: 'Hủy' },
};

function renderWalletTab(onWalletChanged = vi.fn()) {
  return {
    onWalletChanged,
    ...render(
      <WalletTab
        activeTab="wallet"
        students={[]}
        classes={walletClasses}
        language="vi"
        t={t}
        onWalletChanged={onWalletChanged}
      />
    ),
  };
}

describe('WalletTab v2 workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWalletBalances).mockResolvedValue({ students: [] });
    vi.mocked(fetchWalletStudentContext).mockResolvedValue({
      studentId: 's1',
      walletBalance: 0,
      ledgers: [],
    });
    vi.mocked(fetchWalletTransactions).mockResolvedValue({
      walletBalance: 0,
      opening: null,
      transactions: [],
    });
    vi.mocked(voidWalletTransaction).mockResolvedValue({ newBalance: 0 });
  });

  it('renders nothing when inactive', () => {
    const { container } = render(
      <WalletTab activeTab="ledgers" students={[]} classes={walletClasses} language="vi" t={t} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('lists active students including zero balances with all requested columns', async () => {
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          code: 'HS001',
          dob: '2015-05-10',
          classId: 'c1',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          walletBalance: 0,
        },
      ],
    });
    renderWalletTab();

    expect(await screen.findByText('Nguyễn An')).toBeInTheDocument();
    expect(screen.getByText('HS001')).toBeInTheDocument();
    expect(screen.getByText(/10\/05\/2015/)).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('0901000001')).toBeInTheDocument();
    // Scoped to the row: the toolbar also totals the balances on screen.
    const row = screen.getByRole('row', { name: /Nguyễn An/ });
    expect(within(row).getByText('0 đ')).toBeInTheDocument();
  });

  it('shows the class of a closed course, which accounting never receives in the class list', async () => {
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          code: 'HS001',
          dob: '2015-05-10',
          classId: 'closed-class',
          className: 'G6',
          classStatus: 'archived',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          enrollmentStatus: 'promoted',
          walletBalance: 250_000,
        },
      ],
    });
    renderWalletTab();

    expect(await screen.findByText('G6')).toBeInTheDocument();
    expect(screen.getByText(/đã kết thúc/)).toBeInTheDocument();
    expect(screen.getByText('Chờ lên lớp')).toBeInTheDocument();
  });

  it('sums the wallet money on hand for the rows in view', async () => {
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          code: 'HS001',
          dob: '2015-05-10',
          classId: 'c1',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          walletBalance: 250_000,
        },
        {
          id: 's2',
          name: 'Trần Bình',
          code: 'HS002',
          dob: '2015-06-11',
          classId: 'c1',
          contact: '0901000002',
          studentLifecycle: 'enrolled',
          walletBalance: 0,
        },
      ],
    });
    renderWalletTab();

    const total = await screen.findByText('Tổng số dư đang giữ');
    expect(total.parentElement).toHaveTextContent('250.000');
    expect(screen.getByText('Học sinh còn số dư').parentElement).toHaveTextContent('1');
  });

  it('defaults to active students and reveals archived students with the filter', async () => {
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 'active',
          name: 'Học sinh đang học',
          code: 'HS-A',
          dob: '2015-05-10',
          classId: 'c1',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          walletBalance: 0,
        },
        {
          id: 'archived',
          name: 'Học sinh đã nghỉ',
          code: 'HS-B',
          dob: '2014-04-09',
          classId: 'c1',
          contact: '0901000002',
          studentLifecycle: 'archived',
          walletBalance: 100_000,
        },
      ],
    });
    renderWalletTab();

    expect(await screen.findByText('Học sinh đang học')).toBeInTheDocument();
    expect(screen.queryByText('Học sinh đã nghỉ')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Trạng thái học sinh/), {
      target: { value: 'archived' },
    });
    expect(await screen.findByText('Học sinh đã nghỉ')).toBeInTheDocument();
  });

  it('has no top-up action and opens standalone allocation and v2 history', async () => {
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          code: 'HS001',
          dob: '2015-05-10',
          classId: 'c1',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          walletBalance: 1_000_000,
        },
      ],
    });
    vi.mocked(fetchWalletStudentContext).mockResolvedValue({
      studentId: 's1',
      walletBalance: 1_000_000,
      ledgers: [],
    });
    vi.mocked(fetchWalletTransactions).mockResolvedValue({
      walletBalance: 1_000_000,
      opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 1_000_000 },
      transactions: [],
    });
    const user = userEvent.setup();
    renderWalletTab();

    expect(screen.queryByRole('button', { name: /Nạp ví/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Cấn công nợ/ }));
    expect(await screen.findByRole('dialog', { name: /Cấn công nợ/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Đóng/ }));
    await user.click(screen.getByRole('button', { name: /Xem lịch sử/ }));
    expect(await screen.findByText(/Số dư đầu kỳ/)).toBeInTheDocument();
  });

  it('allocates wallet credit with one stable operation key and refreshes balances and ledgers', async () => {
    const user = userEvent.setup();
    const onWalletChanged = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          code: 'HS001',
          dob: '2015-05-10',
          classId: 'c1',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          walletBalance: 1_000_000,
        },
      ],
    });
    vi.mocked(fetchWalletStudentContext).mockResolvedValue({
      studentId: 's1',
      walletBalance: 1_000_000,
      ledgers: [
        {
          id: 'l1',
          studentId: 's1',
          classId: 'c1',
          amount: 900_000,
          paidTotal: 0,
          discountTotal: 0,
          status: 'unpaid',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    } as never);
    vi.mocked(allocateStudentWallet).mockResolvedValue({
      transactionGroupId: 'g1',
      walletBalance: 600_000,
    } as never);

    renderWalletTab(onWalletChanged);
    await user.click(await screen.findByRole('button', { name: /Cấn công nợ/ }));
    await user.click(await screen.findByRole('checkbox', { name: /A1/ }));
    await user.type(screen.getByLabelText(/Số tiền cấn.*A1/), '400000');
    await user.click(screen.getByRole('button', { name: /Xác nhận cấn công nợ/ }));

    await waitFor(() => expect(allocateStudentWallet).toHaveBeenCalledTimes(1));
    expect(allocateStudentWallet).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      studentId: 's1',
      allocations: [{ ledgerId: 'l1', amount: 400_000 }],
    });
    await waitFor(() => expect(fetchWalletBalances).toHaveBeenCalledTimes(2));
    expect(onWalletChanged).toHaveBeenCalledOnce();
  });

  it('voids a posted manual allocation group once and refreshes all wallet views', async () => {
    const user = userEvent.setup();
    const onWalletChanged = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          code: 'HS001',
          dob: '2015-05-10',
          classId: 'c1',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          walletBalance: 300_000,
        },
      ],
    });
    vi.mocked(fetchWalletTransactions).mockResolvedValue({
      walletBalance: 300_000,
      opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 1_000_000 },
      transactions: [
        {
          id: 'a2',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 1,
          source: 'manual_allocation',
          studentId: 's1',
          classId: 'c1',
          ledgerId: 'l2',
          type: 'allocation',
          amount: 300_000,
          signedAmount: -300_000,
          balanceAfter: 300_000,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'a1',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 0,
          source: 'manual_allocation',
          studentId: 's1',
          classId: 'c1',
          ledgerId: 'l1',
          type: 'allocation',
          amount: 400_000,
          signedAmount: -400_000,
          balanceAfter: 600_000,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
        {
          id: 'receipt-row',
          schemaVersion: 2,
          transactionGroupId: 'r1',
          groupSequence: 0,
          source: 'manual_receipt',
          studentId: 's1',
          type: 'deposit',
          amount: 1_000_000,
          signedAmount: 1_000_000,
          balanceAfter: 1_000_000,
          status: 'posted',
          receiptNo: 'PT-001',
          createdBy: 'u1',
          createdAt: '2026-07-27T00:00:00.000Z',
        },
      ],
    } as never);

    renderWalletTab(onWalletChanged);
    await user.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));
    const groupVoid = await screen.findByRole('button', {
      name: /Hủy lần cấn công nợ/,
    });
    expect(screen.getAllByRole('button', { name: /Hủy lần cấn công nợ/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Hủy phiếu thu/ })).not.toBeInTheDocument();

    await user.click(groupVoid);
    const confirm = screen.getByRole('button', { name: /Xác nhận hủy/ });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Lý do hủy/), 'Cấn nhầm công nợ');
    await user.click(confirm);

    await waitFor(() => expect(voidWalletTransaction).toHaveBeenCalledTimes(1));
    expect(voidWalletTransaction).toHaveBeenCalledWith(
      expect.stringMatching(/^a[12]$/),
      'Cấn nhầm công nợ',
      expect.any(String)
    );
    await waitFor(() => expect(fetchWalletBalances).toHaveBeenCalledTimes(2));
    expect(fetchWalletTransactions).toHaveBeenCalledTimes(2);
    expect(onWalletChanged).toHaveBeenCalledOnce();
  });
});

describe('WalletTab student access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWalletTransactions).mockResolvedValue({
      walletBalance: 250_000,
      opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 250_000 },
      transactions: [],
    });
    vi.mocked(fetchWalletBalances).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          code: 'HS001',
          dob: '2015-05-10',
          classId: 'c1',
          contact: '0901000001',
          studentLifecycle: 'enrolled',
          walletBalance: 250_000,
        },
      ],
    });
  });

  it('opens the wallet history inside a dialog instead of an inline panel', async () => {
    const user = userEvent.setup();
    renderWalletTab();

    await user.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));

    const dialog = await screen.findByRole('dialog', { name: /Lịch sử ví/ });
    expect(within(dialog).getByText(/Số dư đầu kỳ/)).toBeInTheDocument();
    expect(within(dialog).getByText('Nguyễn An')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Đóng/ }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Lịch sử ví/ })).not.toBeInTheDocument()
    );
  });

  it('closes the wallet history dialog with the Escape key', async () => {
    const user = userEvent.setup();
    renderWalletTab();

    await user.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));
    expect(await screen.findByRole('dialog', { name: /Lịch sử ví/ })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Lịch sử ví/ })).not.toBeInTheDocument()
    );
  });

  it('leaves the history dialog open when Escape is pressed over a nested dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWalletTransactions).mockResolvedValue({
      walletBalance: 250_000,
      opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 1_000_000 },
      transactions: [
        {
          id: 'a1',
          schemaVersion: 2,
          transactionGroupId: 'g1',
          groupSequence: 0,
          source: 'manual_allocation',
          studentId: 's1',
          classId: 'c1',
          ledgerId: 'l1',
          type: 'allocation',
          amount: 750_000,
          signedAmount: -750_000,
          balanceAfter: 250_000,
          status: 'posted',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    } as never);
    renderWalletTab();

    await user.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));
    await user.click(await screen.findByRole('button', { name: /Hủy lần cấn công nợ/ }));
    expect(await screen.findByLabelText(/Lý do hủy/)).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: /Lịch sử ví/ })).toBeInTheDocument();
  });

  it('labels transaction statuses in Vietnamese instead of raw codes', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWalletTransactions).mockResolvedValue({
      walletBalance: 250_000,
      opening: { startedAt: '2026-07-27T00:00:00.000Z', balance: 1_000_000 },
      transactions: [
        {
          id: 'd1',
          schemaVersion: 2,
          transactionGroupId: 'r1',
          groupSequence: 0,
          source: 'manual_receipt',
          studentId: 's1',
          type: 'deposit',
          amount: 250_000,
          signedAmount: 250_000,
          balanceAfter: 250_000,
          status: 'posted',
          receiptNo: 'PT-001',
          createdBy: 'u1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    } as never);
    renderWalletTab();

    await user.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));
    const dialog = await screen.findByRole('dialog', { name: /Lịch sử ví/ });

    expect(within(dialog).getByText('Đã chốt')).toBeInTheDocument();
    expect(within(dialog).queryByText('posted')).not.toBeInTheDocument();
  });

  it('links the student name to the finance profile in a new browser tab', async () => {
    renderWalletTab();

    const link = await screen.findByRole('link', { name: /Nguyễn An/ });
    expect(link).toHaveAttribute('href', '/students/s1?tab=finance');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
