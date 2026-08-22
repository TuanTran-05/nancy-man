// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Class, CourseFeeLedger, Student } from '../../types';
import { createAndPostReceipt, fetchWalletStudentContext } from '../../lib/api/financeApi';
import { ReceiptModal } from './ReceiptModal';

vi.mock('../../lib/api/financeApi', () => ({
  createAndPostReceipt: vi.fn(),
  fetchWalletStudentContext: vi.fn(),
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return { useLanguage: () => ({ language: 'vi', t: translations.vi }) };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'accounting-1', role: 'accounting' } }),
}));

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

function allocationLedger(id: string, classId: string, remaining: number): CourseFeeLedger {
  return {
    id,
    studentId: 's1',
    classId,
    amount: remaining,
    paidTotal: 0,
    discountTotal: 0,
    status: 'unpaid',
    createdAt: '2026-07-01T00:00:00.000Z',
  } as CourseFeeLedger;
}

const classes = [
  { id: 'c1', name: 'A1', teacherId: 't1', studentIds: [] },
  { id: 'c2', name: 'B1', teacherId: 't1', studentIds: [] },
] as unknown as Class[];

const students = [
  {
    id: 's1',
    name: 'Nguyễn An',
    code: 'HS001',
    studentId: 'HS001',
    classId: 'c1',
    teacherId: 't1',
    dob: '2015-05-10',
    contact: '0901000001',
    createdAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 's2',
    name: 'Trần Bình',
    code: 'HS002',
    studentId: 'HS002',
    classId: 'c2',
    teacherId: 't1',
    dob: '2014-04-09',
    contact: '0901000002',
    createdAt: '2026-07-01T00:00:00.000Z',
  },
] as Student[];

describe('ReceiptModal wallet manual v2 flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAndPostReceipt).mockResolvedValue({
      id: 'r1',
      receiptNo: 'PT-260728-001',
    });
    vi.mocked(fetchWalletStudentContext).mockImplementation(async (studentId) => ({
      studentId,
      walletBalance: studentId === 's1' ? 1_000_000 : 0,
      ledgers:
        studentId === 's1'
          ? [allocationLedger('l1', 'c1', 900_000), allocationLedger('l2', 'c2', 2_000_000)]
          : [],
    }));
  });

  it('defaults the received amount to one million with a 100,000 step and ignores wheel input', () => {
    render(
      <ReceiptModal
        mode="selectable"
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    const amountInput = screen.getByLabelText(/Số tiền thực thu/);
    expect(amountInput).toHaveValue(1_000_000);
    expect(amountInput).toHaveAttribute('step', '100000');

    amountInput.focus();
    fireEvent.wheel(amountInput, { deltaY: 100 });
    expect(amountInput).not.toHaveFocus();
    expect(amountInput).toHaveValue(1_000_000);
  });

  it('loads debts after student selection and submits two explicit allocations', async () => {
    const user = userEvent.setup();
    render(
      <ReceiptModal
        mode="selectable"
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Học sinh/), 's1');
    await waitFor(() => expect(fetchWalletStudentContext).toHaveBeenCalledWith('s1'));
    const amountInput = screen.getByLabelText(/Số tiền thực thu/);
    await user.clear(amountInput);
    await user.type(amountInput, '2000000');
    await user.click(await screen.findByRole('checkbox', { name: /A1/ }));
    expect(screen.getByLabelText(/Số tiền cấn.*A1/)).toHaveValue(900_000);
    await user.click(screen.getByRole('checkbox', { name: /B1/ }));
    const secondAllocation = screen.getByLabelText(/Số tiền cấn.*B1/);
    expect(secondAllocation).toHaveValue(2_000_000);
    await user.clear(secondAllocation);
    await user.type(secondAllocation, '600000');
    await user.click(screen.getByRole('button', { name: /Lưu & Chốt/ }));

    await waitFor(() =>
      expect(createAndPostReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          flowVersion: 'wallet-manual-v2',
          studentId: 's1',
          amountReceived: 2_000_000,
          allocations: [
            expect.objectContaining({ ledgerId: 'l1', amount: 900_000 }),
            expect.objectContaining({ ledgerId: 'l2', amount: 600_000 }),
          ],
        })
      )
    );
  });

  it('submits the computed fixed scholarship amount with the allocation', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWalletStudentContext).mockResolvedValueOnce({
      studentId: 's1',
      walletBalance: 0,
      ledgers: [allocationLedger('l1', 'c1', 1_000_000)],
    });

    render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[0]}
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    const amountInput = screen.getByLabelText(/th.*c thu/i);
    await user.clear(amountInput);
    await user.type(amountInput, '900000');
    await user.click(await screen.findByRole('checkbox', { name: /A1/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: /A1/ }), 'first_prize');
    const allocationInput = screen.getByRole('spinbutton', { name: /A1/ });
    await user.clear(allocationInput);
    await user.type(allocationInput, '900000');
    await user.click(screen.getByRole('button', { name: /&/ }));

    await waitFor(() =>
      expect(createAndPostReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          amountReceived: 900_000,
          allocations: [
            expect.objectContaining({
              ledgerId: 'l1',
              amount: 900_000,
              discountType: 'first_prize',
              discountAmount: 100_000,
            }),
          ],
        })
      )
    );
  });

  it('reloads context and clears debt selection when the student changes', async () => {
    const user = userEvent.setup();
    render(
      <ReceiptModal
        mode="selectable"
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );
    const studentSelect = screen.getByLabelText(/Học sinh/);
    await user.selectOptions(studentSelect, 's1');
    await user.click(await screen.findByRole('checkbox', { name: /A1/ }));
    await user.selectOptions(studentSelect, 's2');

    await waitFor(() => expect(fetchWalletStudentContext).toHaveBeenLastCalledWith('s2'));
    expect(screen.queryByRole('checkbox', { name: /A1/ })).not.toBeInTheDocument();
  });

  it('allows a positive receipt with zero allocations and blocks overspending', async () => {
    const user = userEvent.setup();
    render(
      <ReceiptModal
        mode="selectable"
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );
    await user.selectOptions(screen.getByLabelText(/Học sinh/), 's1');
    const amountInput = screen.getByLabelText(/Số tiền thực thu/);
    await user.clear(amountInput);
    await user.type(amountInput, '100000');
    const save = screen.getByRole('button', { name: /Lưu & Chốt/ });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(createAndPostReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ amountReceived: 100_000, allocations: [] })
      )
    );
  });

  it('fixes the selected student and loads debt context when opened from a debt row', async () => {
    render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[0]}
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    expect(screen.getByRole('dialog', { name: /Thu tiền — Nguyễn An/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thu tiền — Nguyễn An' })).toBeInTheDocument();
    expect(screen.getByText('HS001')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Học sinh$/)).not.toBeInTheDocument();
    await waitFor(() => expect(fetchWalletStudentContext).toHaveBeenCalledWith('s1'));
  });

  it('blocks submission until the fixed-student directory data is ready', () => {
    render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[0]}
        studentDirectoryLoading
        isOpen
        onClose={vi.fn()}
        students={[]}
        classes={classes}
        ledgers={[]}
      />
    );

    expect(screen.getByText(/Đang tải thông tin học sinh/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lưu & Chốt/ })).toBeDisabled();
  });

  it('shows a retry action when fixed-student directory loading fails', async () => {
    const user = userEvent.setup();
    const onRetryStudentDirectory = vi.fn();
    render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[0]}
        studentDirectoryError="Không tải được danh bạ học sinh"
        onRetryStudentDirectory={onRetryStudentDirectory}
        isOpen
        onClose={vi.fn()}
        students={[]}
        classes={classes}
        ledgers={[]}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh bạ học sinh');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetryStudentDirectory).toHaveBeenCalledOnce();
  });

  it('shows an in-modal retry when student debt context fails to load', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWalletStudentContext).mockRejectedValueOnce(
      new Error('Không tải được công nợ học sinh')
    );

    render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[0]}
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được công nợ học sinh');
    await user.click(screen.getByRole('button', { name: 'Tải lại công nợ' }));
    await waitFor(() => expect(fetchWalletStudentContext).toHaveBeenCalledTimes(2));
  });

  it('keeps a positive zero-debt receipt in the wallet and calls onSuccess', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    vi.mocked(fetchWalletStudentContext).mockResolvedValueOnce({
      studentId: 's2',
      walletBalance: 0,
      ledgers: [],
    });

    render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[1]}
        isOpen
        onClose={vi.fn()}
        onSuccess={onSuccess}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    expect(await screen.findByText(/Số tiền thu sẽ được giữ trong ví/i)).toBeInTheDocument();
    const amountInput = screen.getByLabelText(/Số tiền thực thu/);
    await user.clear(amountInput);
    await user.type(amountInput, '100000');
    await user.click(screen.getByRole('button', { name: /Lưu & Chốt/ }));

    await waitFor(() =>
      expect(createAndPostReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 's2',
          amountReceived: 100_000,
          allocations: [],
        })
      )
    );
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('resets the draft and context when a fixed target changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[0]}
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    const amountInput = screen.getByLabelText(/Số tiền thực thu/);
    await user.clear(amountInput);
    await user.type(amountInput, '900000');
    await user.click(await screen.findByRole('checkbox', { name: /A1/ }));

    rerender(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[1]}
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    await waitFor(() => expect(fetchWalletStudentContext).toHaveBeenLastCalledWith('s2'));
    expect(screen.getByLabelText(/Số tiền thực thu/)).toHaveValue(1_000_000);
    expect(screen.queryByRole('checkbox', { name: /A1/ })).not.toBeInTheDocument();
  });

  it('reloads changed debt context and clears allocations after a rejected save', async () => {
    const user = userEvent.setup();
    vi.mocked(createAndPostReceipt).mockRejectedValueOnce(new Error('Số dư đã thay đổi'));

    render(
      <ReceiptModal
        mode="fixed"
        targetStudent={students[0]}
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );

    const amountInput = screen.getByLabelText(/Số tiền thực thu/);
    await user.clear(amountInput);
    await user.type(amountInput, '900000');
    await user.click(await screen.findByRole('checkbox', { name: /A1/ }));
    await user.click(screen.getByRole('button', { name: /Lưu & Chốt/ }));

    await waitFor(() => expect(fetchWalletStudentContext).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(/Số tiền thực thu/)).toHaveValue(900000);
    expect(screen.getByRole('checkbox', { name: /A1/ })).not.toBeChecked();
  });

  it('disables save while selected allocations exceed available wallet funds', async () => {
    const user = userEvent.setup();
    render(
      <ReceiptModal
        mode="selectable"
        isOpen
        onClose={vi.fn()}
        students={students}
        classes={classes}
        ledgers={[]}
      />
    );
    await user.selectOptions(screen.getByLabelText(/Học sinh/), 's1');
    await user.clear(screen.getByLabelText(/Số tiền thực thu/));
    await user.click(await screen.findByRole('checkbox', { name: /B1/ }));
    const allocationInput = screen.getByLabelText(/Số tiền cấn.*B1/);
    expect(allocationInput).toHaveValue(2_000_000);

    expect(screen.getByRole('button', { name: /Lưu & Chốt/ })).toBeDisabled();
    expect(screen.getByText(/vượt quá số dư khả dụng/i)).toBeInTheDocument();
  });
});
