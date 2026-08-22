// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaffForgotPasswordModal } from './StaffForgotPasswordModal';

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      common: { cancel: 'Cancel' },
      staffForgotPasswordModal: {
        title: 'Reset staff password',
        successMessage: 'Request sent',
        forgotPassword: 'Forgot Password',
        requestSent: 'Request Sent!',
        passwordChangedTitle: 'Password Changed!',
        gotIt: 'Got it',
        loginEmail: 'Login Email',
        phoneNumber: 'Zalo Phone Number',
        resetWithZalo: 'Zalo OTP',
        requestAdmin: 'Admin Request',
        zaloDescription: 'Use Zalo OTP',
        adminDescription: 'Request Admin',
        otpSentGeneric: 'OTP sent if matched',
        otpLabel: 'OTP Code',
        otpVerified: 'Verified',
        verifyOtp: 'Verify OTP',
        resendAfter: 'Resend in {seconds}s',
        resendOtp: 'Resend OTP',
        newPassword: 'New Password',
        confirmPassword: 'Confirm Password',
        resetPassword: 'Reset Password',
        sendOtp: 'Send OTP',
        sendRequest: 'Send Request',
      },
    },
  }),
}));

function renderModal(
  overrides: Partial<React.ComponentProps<typeof StaffForgotPasswordModal>> = {}
) {
  const props: React.ComponentProps<typeof StaffForgotPasswordModal> = {
    isOpen: true,
    email: '',
    setEmail: vi.fn(),
    phone: '',
    setPhone: vi.fn(),
    method: 'zalo',
    setMethod: vi.fn(),
    otp: '',
    setOtp: vi.fn(),
    newPassword: '',
    setNewPassword: vi.fn(),
    confirmPassword: '',
    setConfirmPassword: vi.fn(),
    status: { type: 'idle' },
    error: null,
    success: false,
    isProcessing: false,
    language: 'en',
    resendTimer: 0,
    onSubmit: vi.fn((event) => event.preventDefault()),
    onVerifyOtp: vi.fn((event) => event.preventDefault()),
    onResetPassword: vi.fn((event) => event.preventDefault()),
    onClose: vi.fn(),
    ...overrides,
  };

  render(<StaffForgotPasswordModal {...props} />);
  return props;
}

describe('StaffForgotPasswordModal', () => {
  it('shows phone input for Zalo OTP reset', () => {
    renderModal();

    expect(screen.getByLabelText('Login Email')).toBeTruthy();
    expect(screen.getByLabelText('Zalo Phone Number')).toBeTruthy();
    expect(screen.getByRole('button', { name: /send otp/i })).toBeTruthy();
  });

  it('switches to admin request mode without requiring phone', () => {
    const setMethod = vi.fn();
    renderModal({ method: 'zalo', setMethod });

    fireEvent.click(screen.getByRole('button', { name: /admin request/i }));

    expect(setMethod).toHaveBeenCalledWith('request');
  });

  it('renders OTP verification step after OTP is sent', () => {
    renderModal({ status: { type: 'otp_sent', message: 'OTP sent if matched' }, otp: '123456' });

    expect(screen.getByLabelText('OTP Code')).toBeTruthy();
    expect(screen.getByRole('button', { name: /verify otp/i })).toBeTruthy();
  });

  it('renders new password step after OTP verification', () => {
    renderModal({
      status: { type: 'otp_verified' },
      newPassword: 'StrongPass1',
      confirmPassword: 'StrongPass1',
    });

    expect(screen.getByLabelText('New Password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeTruthy();
  });

  it('shows admin request success title for admin-request success', () => {
    renderModal({
      method: 'request',
      success: true,
      status: { type: 'success', message: 'Request sent' },
    });

    expect(screen.getByText('Request Sent!')).toBeTruthy();
    expect(screen.queryByText('Password Changed!')).toBeNull();
  });

  it('shows password changed title for Zalo OTP reset success', () => {
    renderModal({
      method: 'zalo',
      success: true,
      status: { type: 'success', message: 'Password changed successfully' },
    });

    expect(screen.getByText('Password Changed!')).toBeTruthy();
    expect(screen.queryByText('Request Sent!')).toBeNull();
  });
});
