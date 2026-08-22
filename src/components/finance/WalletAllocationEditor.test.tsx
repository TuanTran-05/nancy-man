// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Class, CourseFeeLedger } from '../../types';
import { WalletAllocationEditor, type WalletAllocationDraft } from './WalletAllocationEditor';

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

function allocationClass(id: string, name: string): Class {
  return {
    id,
    name,
    teacherId: 't1',
    studentIds: [],
    createdAt: '2026-07-01T00:00:00.000Z',
  } as unknown as Class;
}

function EditorHarness({
  ledgers = [allocationLedger('l1', 'c1', 900_000), allocationLedger('l2', 'c2', 2_000_000)],
  classes = [allocationClass('c1', 'A1'), allocationClass('c2', 'B1')],
  emptyMessage,
  autoFillSelectedAmount = false,
}: {
  ledgers?: CourseFeeLedger[];
  classes?: Class[];
  emptyMessage?: string;
  autoFillSelectedAmount?: boolean;
}) {
  const [value, setValue] = React.useState<WalletAllocationDraft[]>([]);
  return (
    <WalletAllocationEditor
      ledgers={ledgers}
      classes={classes}
      currentWalletBalance={1_000_000}
      depositAmount={2_000_000}
      value={value}
      onChange={setValue}
      allowDiscounts={false}
      autoFillSelectedAmount={autoFillSelectedAmount}
      emptyMessage={emptyMessage}
    />
  );
}

describe('WalletAllocationEditor', () => {
  it('uses a receipt-specific empty message without changing the default', () => {
    const { rerender } = render(<EditorHarness ledgers={[]} />);
    expect(screen.getByText(/không còn khoản công nợ cần thanh toán/i)).toBeInTheDocument();

    rerender(
      <EditorHarness
        ledgers={[]}
        emptyMessage="Học sinh không còn khoản công nợ cần thanh toán. Số tiền thu sẽ được giữ trong ví."
      />
    );
    expect(screen.getByText(/Số tiền thu sẽ được giữ trong ví/i)).toBeInTheDocument();
  });

  it('allocates a receipt to multiple debts and keeps the remainder in the wallet', async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    await user.click(screen.getByRole('checkbox', { name: /A1/ }));
    await user.type(screen.getByLabelText(/Số tiền cấn.*A1/), '900000');
    await user.click(screen.getByRole('checkbox', { name: /B1/ }));
    await user.type(screen.getByLabelText(/Số tiền cấn.*B1/), '600000');

    expect(screen.getByTestId('wallet-ending-balance')).toHaveTextContent('1.500.000');
    expect(screen.getByTestId('wallet-allocated-total')).toHaveTextContent('1.500.000');
  });

  it('prefills each selected debt while keeping the amount editable', async () => {
    const user = userEvent.setup();
    render(<EditorHarness autoFillSelectedAmount />);

    await user.click(screen.getByRole('checkbox', { name: /A1/ }));
    const firstAmount = screen.getByLabelText(/Số tiền cấn.*A1/);
    expect(firstAmount).toHaveValue(900_000);

    await user.click(screen.getByRole('checkbox', { name: /B1/ }));
    expect(screen.getByLabelText(/Số tiền cấn.*B1/)).toHaveValue(2_000_000);
    expect(screen.getByTestId('wallet-allocated-total')).toHaveTextContent('2.900.000');

    await user.clear(firstAmount);
    await user.type(firstAmount, '400000');
    expect(firstAmount).toHaveValue(400_000);
    expect(screen.getByTestId('wallet-allocated-total')).toHaveTextContent('2.400.000');

    firstAmount.focus();
    fireEvent.wheel(firstAmount, { deltaY: 100 });
    expect(firstAmount).not.toHaveFocus();
    expect(firstAmount).toHaveValue(400_000);
  });

  it('enforces the 20-ledger allocation limit in the editor', async () => {
    const user = userEvent.setup();
    const ledgers = Array.from({ length: 21 }, (_, index) =>
      allocationLedger(`l${index + 1}`, `c${index + 1}`, 100_000)
    );
    const classes = Array.from({ length: 21 }, (_, index) =>
      allocationClass(`c${index + 1}`, `Lớp ${index + 1}`)
    );
    render(<EditorHarness ledgers={ledgers} classes={classes} />);

    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes.slice(0, 20)) await user.click(checkbox);

    expect(checkboxes[20]).toBeDisabled();
    expect(screen.getByText(/tối đa 20 khoản công nợ/i)).toBeInTheDocument();
  });
});
