// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPage } from './UsersPage.js';

const owner = {
  userId: 'owner-id',
  username: 'tuan.dev',
  displayName: 'Tuan Dev',
  role: 'ops_owner' as const,
  csrfToken: 'csrf-token'
};

const accounts = [
  {
    id: 'owner-id',
    username: 'tuan.dev',
    email: 'tuan@example.test',
    displayName: 'Tuan Dev',
    role: 'ops_owner',
    status: 'active',
    mfaEnrolled: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    lastLoginAt: '2026-08-31T00:00:00.000Z'
  },
  {
    id: 'maintainer-id',
    username: 'ops-new',
    email: 'new@example.test',
    displayName: 'New Operator',
    role: 'ops_maintainer',
    status: 'active',
    mfaEnrolled: true,
    createdAt: '2026-08-02T00:00:00.000Z',
    lastLoginAt: null
  },
  {
    id: 'locked-id',
    username: 'locked.user',
    email: 'locked@example.test',
    displayName: 'Locked User',
    role: 'ops_viewer',
    status: 'locked',
    mfaEnrolled: true,
    createdAt: '2026-08-03T00:00:00.000Z',
    lastLoginAt: null
  },
  {
    id: 'revoked-id',
    username: 'revoked.user',
    email: 'revoked@example.test',
    displayName: 'Revoked User',
    role: 'ops_viewer',
    status: 'revoked',
    mfaEnrolled: true,
    createdAt: '2026-08-04T00:00:00.000Z',
    lastLoginAt: null
  }
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('UsersPage', () => {
  afterEach(() => cleanup());

  it('renders owner controls, defaults new accounts to Maintainer, and explains protected rows', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).endsWith('/api/v1/users')) return jsonResponse({ accounts });
      throw new Error(`unexpected request ${String(input)}`);
    });
    render(<UsersPage session={owner} onUnauthorized={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Người dùng' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Vai trò tài khoản mới' })).toHaveValue('ops_maintainer');
    expect(screen.getByText('Không thể tự khóa hoặc tự thu hồi tài khoản owner đang đăng nhập.')).toBeInTheDocument();
    expect(screen.getByText('Không thể xóa owner cuối cùng.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cấp lại liên kết MFA cho locked.user' })).toBeInTheDocument();
    expect(screen.getByText('Đã thu hồi — trạng thái kết thúc')).toBeInTheDocument();
  });

  it('holds a full one-time 24-hour enrollment link in the page and clears it on dismiss', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async (input, init) => {
      if (String(input).endsWith('/api/v1/users') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({ accounts: [accounts[0]] });
      }
      expect(init?.method).toBe('POST');
      return jsonResponse({
        userId: 'new-id',
        enrollmentUrl: 'https://man.thienuy.edu.vn/bootstrap/mfa?token=one-time-secret',
        expiresAt: '2026-09-01T12:00:00.000Z'
      }, 201);
    });
    render(<UsersPage session={owner} onUnauthorized={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Người dùng' });
    await user.type(screen.getByLabelText('Tên đăng nhập mới'), 'ops-new');
    await user.type(screen.getByLabelText('Email mới'), 'new@example.test');
    await user.type(screen.getByLabelText('Tên hiển thị mới'), 'New Operator');
    await user.click(screen.getByRole('button', { name: 'Tạo liên kết enrollment' }));
    const link = await screen.findByDisplayValue('https://man.thienuy.edu.vn/bootstrap/mfa?token=one-time-secret');
    expect(link).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByText(/hết hạn sau 24 giờ/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ẩn liên kết enrollment' }));
    expect(screen.queryByDisplayValue(/one-time-secret/)).not.toBeInTheDocument();
  });
});
