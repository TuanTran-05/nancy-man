// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZaloActionDialog } from './ZaloActionDialog';

const baseProps = {
  isOpen: true,
  title: 'Confirm send',
  description: 'Review before sending.',
  closeLabel: 'Close',
  cancelLabel: 'Back',
  confirmLabel: 'Confirm send',
};

describe('ZaloActionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.cssText = '';
    document.documentElement.style.cssText = '';
  });

  it('renders an accessible modal, locks scroll, ignores the backdrop, and restores focus', async () => {
    const onClose = vi.fn();
    const launcher = document.createElement('button');
    launcher.textContent = 'Open';
    document.body.appendChild(launcher);
    launcher.focus();

    const { rerender, unmount } = render(
      <ZaloActionDialog {...baseProps} onClose={onClose} onConfirm={vi.fn()}>
        <p>Confirmation content</p>
      </ZaloActionDialog>
    );

    expect(screen.getByRole('dialog', { name: 'Confirm send' })).toBeInTheDocument();
    expect(screen.getByText('Confirmation content')).toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');

    fireEvent.click(screen.getByTestId('zalo-action-dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ZaloActionDialog {...baseProps} isOpen={false} onClose={onClose} onConfirm={vi.fn()}>
        <p>Confirmation content</p>
      </ZaloActionDialog>
    );

    await waitFor(() => expect(launcher).toHaveFocus());
    expect(document.body.style.position).toBe('');
    unmount();
    launcher.remove();
  });

  it('blocks close, cancel, and confirm while a request is pending', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ZaloActionDialog {...baseProps} isPending onClose={onClose} onConfirm={onConfirm}>
        <p>Confirmation content</p>
      </ZaloActionDialog>
    );

    const close = screen.getByRole('button', { name: 'Close' });
    const cancel = screen.getByRole('button', { name: 'Back' });
    const confirm = screen.getByRole('button', { name: 'Confirm send' });
    expect(close).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(confirm).toBeDisabled();

    fireEvent.click(close);
    fireEvent.click(cancel);
    fireEvent.click(confirm);
    fireEvent.click(screen.getByTestId('zalo-action-dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
