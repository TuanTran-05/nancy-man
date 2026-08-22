// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseModal } from './ExpenseModal';
import { createAndPostExpense, fetchWalletStudentContext } from '../../lib/api/financeApi';

vi.mock('../../lib/api/financeApi', () => ({
  createAndPostExpense: vi.fn(),
  fetchWalletStudentContext: vi.fn(),
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'en', t: translations.en }),
  };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'accounting-1', role: 'accounting' } }),
}));

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ExpenseModal', () => {
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
      classId: 'c1',
      teacherId: 't1',
      dob: '2015-06-11',
      contact: '0901000002',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ] as never;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAndPostExpense).mockResolvedValue({
      id: 'expense-1',
      expenseNo: 'PC-260526-001',
    });
    vi.mocked(fetchWalletStudentContext).mockResolvedValue({
      studentId: 's1',
      walletBalance: 700,
      ledgers: [],
    });
  });

  it('keeps the modal open when create-and-post fails', async () => {
    vi.mocked(createAndPostExpense).mockRejectedValue(new Error('post failed'));
    const onClose = vi.fn();

    render(<ExpenseModal isOpen={true} onClose={onClose} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '250000' } });
    fireEvent.change(screen.getByPlaceholderText('Payee name...'), {
      target: { value: 'Vendor A' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. buy classroom supplies, repairs...'), {
      target: { value: 'Classroom supplies' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & Post/ }));

    await waitFor(() => {
      expect(createAndPostExpense).toHaveBeenCalledOnce();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not send a client-generated expense number when creating and posting', async () => {
    const onClose = vi.fn();

    render(<ExpenseModal isOpen={true} onClose={onClose} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '250000' } });
    fireEvent.change(screen.getByPlaceholderText('Payee name...'), {
      target: { value: 'Vendor A' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. buy classroom supplies, repairs...'), {
      target: { value: 'Classroom supplies' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & Post/ }));

    await waitFor(() => {
      expect(createAndPostExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: expect.any(String),
          amount: 250000,
          payee: 'Vendor A',
          purpose: 'Classroom supplies',
        })
      );
    });
    expect(vi.mocked(createAndPostExpense).mock.calls[0]?.[0]).not.toHaveProperty('expenseNo');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('requires a student and reason for wallet refund mode', async () => {
    const user = userEvent.setup();
    render(<ExpenseModal isOpen onClose={vi.fn()} students={students} />);

    await user.selectOptions(screen.getByLabelText(/Expense type/i), 'wallet_refund');
    await user.click(screen.getByRole('button', { name: /Save & Post/i }));

    expect(createAndPostExpense).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/select a student/i);

    await user.selectOptions(screen.getByLabelText(/^Student/i), 's1');
    expect(await screen.findByText(/700/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save & Post/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/refund reason/i);
  });

  it('loads the server wallet balance and rejects an excessive refund before submit', async () => {
    const user = userEvent.setup();
    render(<ExpenseModal isOpen onClose={vi.fn()} students={students} />);

    await user.selectOptions(screen.getByLabelText(/Expense type/i), 'wallet_refund');
    await user.selectOptions(screen.getByLabelText(/^Student/i), 's1');
    expect(await screen.findByText(/700/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Amount/i), '800');
    await user.type(screen.getByLabelText(/Payee/i), 'Phụ huynh Nguyễn An');
    await user.type(screen.getByLabelText(/Refund reason/i), 'Học sinh nghỉ học');
    await user.click(screen.getByRole('button', { name: /Save & Post/i }));

    expect(createAndPostExpense).not.toHaveBeenCalled();
    expect(screen.getByText(/exceeds.*wallet balance/i)).toBeInTheDocument();
  });

  it('submits a valid wallet refund without generic activity fields', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExpenseModal isOpen onClose={onClose} students={students} />);

    await user.selectOptions(screen.getByLabelText(/Expense type/i), 'wallet_refund');
    await user.selectOptions(screen.getByLabelText(/^Student/i), 's1');
    await screen.findByText(/700/);
    await user.type(screen.getByLabelText(/^Amount/i), '500');
    await user.type(screen.getByLabelText(/Payee/i), 'Phụ huynh Nguyễn An');
    await user.type(screen.getByLabelText(/Refund reason/i), 'Học sinh nghỉ học');
    await user.click(screen.getByRole('button', { name: /Save & Post/i }));

    await waitFor(() =>
      expect(createAndPostExpense).toHaveBeenCalledWith({
        idempotencyKey: expect.any(String),
        type: 'wallet_refund',
        studentId: 's1',
        amount: 500,
        paidDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        payee: 'Phụ huynh Nguyễn An',
        reason: 'Học sinh nghỉ học',
        note: '',
      })
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables submit while loading the selected student wallet context', async () => {
    let resolveContext!: (value: { studentId: string; walletBalance: number; ledgers: [] }) => void;
    vi.mocked(fetchWalletStudentContext).mockReturnValue(
      new Promise((resolve) => {
        resolveContext = resolve;
      })
    );
    const user = userEvent.setup();
    render(<ExpenseModal isOpen onClose={vi.fn()} students={students} />);

    await user.selectOptions(screen.getByLabelText(/Expense type/i), 'wallet_refund');
    await user.selectOptions(screen.getByLabelText(/^Student/i), 's1');
    expect(screen.getByRole('button', { name: /Save & Post/i })).toBeDisabled();

    resolveContext({ studentId: 's1', walletBalance: 700, ledgers: [] });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save & Post/i })).not.toBeDisabled()
    );
  });

  it('ignores a stale wallet response after selecting another student', async () => {
    const resolvers = new Map<
      string,
      (value: { studentId: string; walletBalance: number; ledgers: [] }) => void
    >();
    vi.mocked(fetchWalletStudentContext).mockImplementation(
      (studentId) =>
        new Promise((resolve) => {
          resolvers.set(studentId, resolve);
        })
    );
    const user = userEvent.setup();
    render(<ExpenseModal isOpen onClose={vi.fn()} students={students} />);

    await user.selectOptions(screen.getByLabelText(/Expense type/i), 'wallet_refund');
    await user.selectOptions(screen.getByLabelText(/^Student/i), 's1');
    await user.selectOptions(screen.getByLabelText(/^Student/i), 's2');
    resolvers.get('s2')?.({ studentId: 's2', walletBalance: 900, ledgers: [] });
    expect(await screen.findByText(/900/)).toBeInTheDocument();
    resolvers.get('s1')?.({ studentId: 's1', walletBalance: 100, ledgers: [] });

    await waitFor(() => expect(screen.queryByText(/^100/)).not.toBeInTheDocument());
    expect(screen.getByText(/900/)).toBeInTheDocument();
  });
});
