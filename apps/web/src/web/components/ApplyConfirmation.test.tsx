// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApplyConfirmation } from './ApplyConfirmation.js';

describe('ApplyConfirmation', () => {
  it('requires password and a six digit TOTP before confirming', () => {
    const onConfirm = vi.fn();
    render(
      <ApplyConfirmation
        digest={'hmac-sha256:v1:' + 'a'.repeat(64)}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const button = screen.getByRole('button', { name: 'Xác nhận' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password' } });
    fireEvent.change(screen.getByLabelText('Mã TOTP'), { target: { value: '123456' } });
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith({ password: 'password', totpCode: '123456' });
  });
});
