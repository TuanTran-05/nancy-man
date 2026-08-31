// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RevokeUserDialog } from './RevokeUserDialog.js';

describe('RevokeUserDialog', () => {
  it('requires the exact username before allowing permanent revoke', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RevokeUserDialog username="ops-target" onCancel={vi.fn()} onConfirm={onConfirm} />);
    const input = screen.getByLabelText('Nhập lại username để thu hồi');
    const revoke = screen.getByRole('button', { name: 'Thu hồi vĩnh viễn' });
    expect(revoke).toBeDisabled();
    await user.type(input, 'ops-wrong');
    expect(revoke).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'ops-target');
    expect(revoke).toBeEnabled();
    await user.click(revoke);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
