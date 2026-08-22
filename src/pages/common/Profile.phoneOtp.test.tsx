// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Profile from './Profile';
import { apiRequest } from '../../lib/api/apiClient';

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    email: 'teacher.teacher@nancy.com',
    providerData: [] as unknown[],
    getIdToken: vi.fn().mockResolvedValue('token'),
  },
}));

let mockProfile: any;

const mockUpdateProfileState = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    profile: mockProfile,
    updateProfileState: mockUpdateProfileState,
  }),
}));

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: mockAuthUser },
}));

vi.mock('@/src/test/legacyAuthTestApi', () => ({
  GoogleAuthProvider: vi.fn(),
  linkWithPopup: vi.fn(),
}));

describe('Profile staff phone OTP flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('language', 'en');
    mockProfile = {
      uid: 'staff-uid-1',
      email: 'teacher.teacher@nancy.com',
      displayName: 'Teacher One',
      role: 'teacher',
      bio: '',
    };
  });

  it('shows email as read-only personal info and missing phone warning in security tab', async () => {
    render(<Profile profile={mockProfile} />);

    expect(screen.getByLabelText(/email/i)).toHaveValue('teacher.teacher@nancy.com');
    expect(screen.queryByText(/email address \/ phone number/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /security/i }));

    expect(screen.getByText(/you have not added a phone number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add phone number/i })).toBeInTheDocument();
  });

  it('shows current staff phone and opens change phone modal', async () => {
    mockProfile.phone = '84384072314';

    render(<Profile profile={mockProfile} />);

    fireEvent.click(screen.getByRole('button', { name: /security/i }));

    expect(screen.getByText('0384072314')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /change phone number/i }));

    expect(screen.getByRole('dialog', { name: /change zalo phone number/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/account email/i)).toHaveValue('teacher.teacher@nancy.com');
  });

  it('runs input, OTP, verified review, and confirm states', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, phone: '84384072314' })
      .mockResolvedValueOnce({ success: true, phone: '84384072314' });

    render(<Profile profile={mockProfile} />);

    fireEvent.click(screen.getByRole('button', { name: /security/i }));
    fireEvent.click(screen.getByRole('button', { name: /add phone number/i }));
    fireEvent.change(screen.getByLabelText(/new phone number/i), {
      target: { value: '0384072314' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send otp/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/request-profile-phone-otp', {
        method: 'POST',
        body: { phone: '0384072314' },
      });
    });

    fireEvent.change(screen.getByLabelText(/otp code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify otp/i }));

    expect(await screen.findByText(/new phone number verified successfully/i)).toBeInTheDocument();
    expect(screen.getByText(/current phone/i)).toBeInTheDocument();
    expect(screen.getByText(/verified new phone/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm phone change/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/auth/confirm-profile-phone-change', {
        method: 'POST',
      });
    });
    expect(await screen.findByText(/phone number updated successfully/i)).toBeInTheDocument();
    // The server returns the canonical stored form; the typed input is not it.
    expect(mockUpdateProfileState).toHaveBeenCalledWith({ phone: '84384072314' });
  });

  it('does not patch the cached profile when confirming the phone change fails', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, phone: '84384072314' })
      .mockRejectedValueOnce(new Error('confirm failed'));

    render(<Profile profile={mockProfile} />);

    fireEvent.click(screen.getByRole('button', { name: /security/i }));
    fireEvent.click(screen.getByRole('button', { name: /add phone number/i }));
    fireEvent.change(screen.getByLabelText(/new phone number/i), {
      target: { value: '0384072314' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send otp/i }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/otp code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify otp/i }));
    expect(await screen.findByText(/new phone number verified successfully/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm phone change/i }));

    expect(await screen.findByText(/confirm failed/i)).toBeInTheDocument();
    expect(mockUpdateProfileState).not.toHaveBeenCalled();
  });

  it('updates local profile state immediately when saving profile details', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: true });

    render(<Profile profile={mockProfile} />);

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Teacher Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/students/update-profile', {
        method: 'POST',
        body: {
          displayName: 'Teacher Updated',
          faceImage: '',
          bio: '',
        },
      });
    });

    expect(mockUpdateProfileState).toHaveBeenCalledWith({
      displayName: 'Teacher Updated',
      faceImage: '',
      bio: '',
    });
  });

  it('renders resend cooldown and admin guidance after sending OTP', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: true });

    render(<Profile profile={mockProfile} />);

    fireEvent.click(screen.getByRole('button', { name: /security/i }));
    fireEvent.click(screen.getByRole('button', { name: /add phone number/i }));
    fireEvent.change(screen.getByLabelText(/new phone number/i), {
      target: { value: '0384072314' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send otp/i }));

    expect(await screen.findByText(/contact admin/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resend in 60s/i })).toBeDisabled();
  });
});
