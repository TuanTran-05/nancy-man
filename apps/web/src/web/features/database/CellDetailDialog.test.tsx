// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellDetailDialog } from './CellDetailDialog.js';

afterEach(() => cleanup());

describe('CellDetailDialog component', () => {
  it('renders JSON value as formatted pre text and copies value', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true
    });

    render(
      <CellDetailDialog
        open={true}
        columnName="metadata"
        cell={{ state: 'value', value: { role: 'admin', active: true } }}
        onClose={() => {}}
      />
    );

    expect(screen.getByRole('heading', { name: /Chi tiết ô metadata/i })).toBeInTheDocument();
    expect(screen.getByText(/"role": "admin"/)).toBeInTheDocument();

    const copyBtn = screen.getByRole('button', { name: 'Sao chép giá trị' });
    expect(copyBtn).toBeEnabled();

    await user.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('{\n  "role": "admin",\n  "active": true\n}');
  });

  it('disables copy button for blocked cell and masked cell', () => {
    const { rerender } = render(
      <CellDetailDialog
        open={true}
        columnName="password_hash"
        cell={{ state: 'blocked' }}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/Giá trị bị chặn bởi chính sách bảo mật/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Không thể sao chép' })).toBeDisabled();

    rerender(
      <CellDetailDialog
        open={true}
        columnName="email"
        cell={{ state: 'masked', display: 'u***@example.com' }}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('u***@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Không thể sao chép' })).toBeDisabled();
  });
});
