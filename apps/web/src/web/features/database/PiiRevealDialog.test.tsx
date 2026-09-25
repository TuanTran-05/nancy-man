// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PiiRevealDialog } from './PiiRevealDialog.js';

afterEach(() => cleanup());

describe('PiiRevealDialog component', () => {
  it('renders target name and fields', () => {
    render(
      <PiiRevealDialog
        open={true}
        targetName="EduTrack Production"
        onClose={() => {}}
        onSubmit={async () => {}}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Mở khóa dữ liệu nhạy cảm (PII)' })
    ).toBeInTheDocument();
    expect(screen.getByText(/EduTrack Production/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu tài khoản')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã xác thực TOTP (6 số)')).toBeInTheDocument();
    expect(screen.getByLabelText('Lý do truy cập (tối thiểu 10 ký tự)')).toBeInTheDocument();
  });

  it('validates fields and calls onSubmit with password, token, and reason', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <PiiRevealDialog
        open={true}
        targetName="EduTrack Production"
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    const submitBtn = screen.getByRole('button', { name: 'Xác thực & Mở khóa' });

    // Submit with empty fields -> should not call onSubmit
    await user.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();

    // Fill password
    await user.type(screen.getByLabelText('Mật khẩu tài khoản'), 'MyPassword123!');
    // Fill invalid TOTP (not 6 digits)
    await user.type(screen.getByLabelText('Mã xác thực TOTP (6 số)'), '123');
    // Fill short reason (< 10 chars)
    await user.type(screen.getByLabelText('Lý do truy cập (tối thiểu 10 ký tự)'), 'short');

    await user.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();

    // Fix TOTP and reason
    await user.clear(screen.getByLabelText('Mã xác thực TOTP (6 số)'));
    await user.type(screen.getByLabelText('Mã xác thực TOTP (6 số)'), '123456');

    await user.clear(screen.getByLabelText('Lý do truy cập (tối thiểu 10 ký tự)'));
    await user.type(
      screen.getByLabelText('Lý do truy cập (tối thiểu 10 ký tự)'),
      'Kiểm tra lỗi tài khoản học sinh INC-9988'
    );

    await user.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledWith(
      'MyPassword123!',
      '123456',
      'Kiểm tra lỗi tài khoản học sinh INC-9988'
    );
  });

  it('clears password and TOTP on close', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(
      <PiiRevealDialog
        open={true}
        targetName="EduTrack Production"
        onClose={onClose}
        onSubmit={async () => {}}
      />
    );

    const passwordInput = screen.getByLabelText('Mật khẩu tài khoản') as HTMLInputElement;
    const totpInput = screen.getByLabelText('Mã xác thực TOTP (6 số)') as HTMLInputElement;

    await user.type(passwordInput, 'SecretPassword');
    await user.type(totpInput, '654321');

    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onClose).toHaveBeenCalled();

    // Reopen dialog
    rerender(
      <PiiRevealDialog
        open={false}
        targetName="EduTrack Production"
        onClose={onClose}
        onSubmit={async () => {}}
      />
    );
    rerender(
      <PiiRevealDialog
        open={true}
        targetName="EduTrack Production"
        onClose={onClose}
        onSubmit={async () => {}}
      />
    );

    expect((screen.getByLabelText('Mật khẩu tài khoản') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Mã xác thực TOTP (6 số)') as HTMLInputElement).value).toBe('');
  });

  it('focuses the password field and closes on Escape', async () => {
    const user = userEvent.setup();
    function DialogHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open PII dialog
          </button>
          <PiiRevealDialog
            open={open}
            targetName="EduTrack Production"
            onClose={() => setOpen(false)}
            onSubmit={async () => {}}
          />
        </>
      );
    }

    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Open PII dialog' }));
    expect(screen.getByLabelText('Mật khẩu tài khoản')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open PII dialog' })).toHaveFocus();
  });
});
