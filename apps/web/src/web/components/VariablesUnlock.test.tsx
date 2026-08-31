// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VariablesUnlock } from './VariablesUnlock.js';

describe('VariablesUnlock', () => {
  it('submits the current password and six-digit TOTP with secure input semantics', async () => {
    const onUnlock = vi.fn(async () => undefined);
    render(<VariablesUnlock onUnlock={onUnlock} error={null} />);

    const password = screen.getByLabelText('Mật khẩu hiện tại');
    const totp = screen.getByLabelText('Mã TOTP');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(totp).toHaveAttribute('inputmode', 'numeric');
    expect(totp).toHaveAttribute('autocomplete', 'one-time-code');
    expect(totp).toHaveAttribute('pattern', '[0-9]{6}');
    expect(totp).toHaveAttribute('maxlength', '6');

    fireEvent.change(password, { target: { value: 'synthetic-password' } });
    fireEvent.change(totp, { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Mở khóa giá trị' }).closest('form')!);

    expect(onUnlock).toHaveBeenCalledWith({
      password: 'synthetic-password',
      totpCode: '123456'
    });
  });
});
