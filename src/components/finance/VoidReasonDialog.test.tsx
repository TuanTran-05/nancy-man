// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VoidReasonDialog } from './VoidReasonDialog';

function renderDialog(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  const view = render(
    <VoidReasonDialog
      isOpen
      title="Hủy phiếu thu"
      message="Giao dịch sẽ được hoàn tác."
      confirmLabel="Xác nhận hủy"
      operationPrefix="receipt-void"
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
  return { ...view, onClose, onConfirm };
}

describe('VoidReasonDialog', () => {
  it('requires a non-blank reason before confirmation', async () => {
    const user = userEvent.setup();
    renderDialog();
    const confirm = screen.getByRole('button', { name: 'Xác nhận hủy' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Lý do hủy'), '   ');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Lý do hủy'), 'Thu nhầm học sinh');
    expect(confirm).toBeEnabled();
  });

  it('keeps one idempotency key while retrying a failed open dialog', async () => {
    const user = userEvent.setup();
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(undefined);
    renderDialog(onConfirm);
    await user.type(screen.getByLabelText('Lý do hủy'), 'Thu nhầm học sinh');
    await user.click(screen.getByRole('button', { name: 'Xác nhận hủy' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Xác nhận hủy' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(onConfirm.mock.calls[1][0].idempotencyKey).toBe(
      onConfirm.mock.calls[0][0].idempotencyKey
    );
  });

  it('prevents duplicate confirmation while a request is in flight', async () => {
    const user = userEvent.setup();
    let resolveRequest!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        })
    );
    const { onClose } = renderDialog(onConfirm);
    await user.type(screen.getByLabelText('Lý do hủy'), 'Thu nhầm học sinh');
    const confirm = screen.getByRole('button', { name: 'Xác nhận hủy' });
    await user.dblClick(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    resolveRequest();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('generates a new key after the dialog closes and reopens', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('retryable'));
    const { rerender } = renderDialog(onConfirm);
    await user.type(screen.getByLabelText('Lý do hủy'), 'Lần một');
    await user.click(screen.getByRole('button', { name: 'Xác nhận hủy' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const firstKey = onConfirm.mock.calls[0][0].idempotencyKey;

    rerender(
      <VoidReasonDialog
        isOpen={false}
        title="Hủy phiếu thu"
        message="Giao dịch sẽ được hoàn tác."
        confirmLabel="Xác nhận hủy"
        operationPrefix="receipt-void"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    rerender(
      <VoidReasonDialog
        isOpen
        title="Hủy phiếu thu"
        message="Giao dịch sẽ được hoàn tác."
        confirmLabel="Xác nhận hủy"
        operationPrefix="receipt-void"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    await user.type(screen.getByLabelText('Lý do hủy'), 'Lần hai');
    await user.click(screen.getByRole('button', { name: 'Xác nhận hủy' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(onConfirm.mock.calls[1][0].idempotencyKey).not.toBe(firstKey);
  });
});
