// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateStaffModal } from './CreateStaffModal';
import { apiRequest } from '../../lib/api/apiClient';

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'en', t: translations.en }),
  };
});

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('../../lib/zalo/zaloService', () => ({
  isValidVNPhone: vi.fn().mockReturnValue(true),
  normalizePhoneVN: vi.fn((phone: string) => phone),
  sendStaffCredentialsNotification: vi.fn(),
}));

describe('CreateStaffModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a recovery action message when creating an existing email conflicts', async () => {
    const error = Object.assign(new Error('Email already exists'), {
      status: 409,
      data: { errorCode: 'email_already_exists' },
    });
    vi.mocked(apiRequest).mockRejectedValue(error);
    const onClose = vi.fn();

    render(<CreateStaffModal isOpen={true} onClose={onClose} initialName="Existing Teacher" />);

    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'existing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Email already exists. Edit the staff profile, unblock access, or reset the password from the staff list.'
        )
      ).toBeDefined();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers only supported staff roles', () => {
    render(<CreateStaffModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Teacher/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Office/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accounting/ })).toBeInTheDocument();
    expect(screen.queryByText(/Managed level/)).not.toBeInTheDocument();
  });

  it('replaces the create action with a close action after the account is created', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        uid: 'staff-1',
        email: 'new.teacher@nancy.com',
        retrievalToken: 'retrieve-token',
        authCreated: true,
        zaloSent: true,
      })
      .mockResolvedValueOnce({
        success: true,
        tempPassword: 'temp-pass',
      });
    const onClose = vi.fn();

    render(<CreateStaffModal isOpen={true} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'new' },
    });
    fireEvent.change(screen.getByLabelText(/Full name/), {
      target: { value: 'New Teacher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('temp-pass')).toBeDefined();
      expect(screen.getByText('Zalo sent.')).toBeDefined();
    });

    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull();

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    expect(closeButtons).toHaveLength(2);
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('updates email suffix and submits office role when office is selected', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      uid: 'office-1',
      email: 'frontdesk.office@nancy.com',
      tempPassword: 'temp-pass',
      authCreated: true,
    });

    render(<CreateStaffModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Office/ }));
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'frontdesk' },
    });
    fireEvent.change(screen.getByLabelText(/Full name/), {
      target: { value: 'Front Desk' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/staff-create-account', {
        method: 'POST',
        body: {
          emailPrefix: 'frontdesk',
          displayName: 'Front Desk',
          role: 'office',
          phone: undefined,
        },
      });
    });
  });
});
