// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';
import { useLoginHandlers } from '../../hooks/useLoginHandlers';
import { CENTER_LOGO_URL } from '../../lib/brand';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock('../../components/auth/StaffForgotPasswordModal', () => ({
  StaffForgotPasswordModal: () => null,
}));

vi.mock('../../components/auth/ForgotPasswordModal', () => ({
  ForgotPasswordModal: () => null,
}));

vi.mock('../../components/auth/TurnstileWidget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget" />,
}));

vi.mock('../../hooks/useLoginHandlers', () => ({
  useLoginHandlers: vi.fn(),
}));

function loginState(overrides: Record<string, unknown> = {}) {
  return {
    language: 'en',
    T: {},
    loginType: 'staff',
    setLoginType: vi.fn(),
    error: null,
    isLoggingIn: false,
    staffEmail: '',
    setStaffEmail: vi.fn(),
    staffPassword: '',
    setStaffPassword: vi.fn(),
    studentCode: '',
    setStudentCode: vi.fn(),
    studentPassword: '',
    setStudentPassword: vi.fn(),
    showForgotModal: false,
    setShowForgotModal: vi.fn(),
    forgotId: '',
    setForgotId: vi.fn(),
    forgotPhone: '',
    setForgotPhone: vi.fn(),
    resetMethod: 'request',
    setResetMethod: vi.fn(),
    otpCode: '',
    setOtpCode: vi.fn(),
    newPassword: '',
    setNewPassword: vi.fn(),
    confirmNewPassword: '',
    setConfirmNewPassword: vi.fn(),
    forgotStatus: { type: 'idle' },
    setForgotStatus: vi.fn(),
    isProcessingForgot: false,
    showStaffForgotModal: false,
    setShowStaffForgotModal: vi.fn(),
    staffForgotEmail: '',
    setStaffForgotEmail: vi.fn(),
    staffForgotPhone: '',
    setStaffForgotPhone: vi.fn(),
    staffForgotMethod: 'zalo',
    setStaffForgotMethod: vi.fn(),
    staffForgotOtp: '',
    setStaffForgotOtp: vi.fn(),
    staffForgotResetToken: vi.fn(),
    staffForgotError: null,
    setStaffForgotError: vi.fn(),
    staffForgotSuccess: false,
    setStaffForgotSuccess: vi.fn(),
    staffForgotStatus: { type: 'idle' },
    setStaffForgotStatus: vi.fn(),
    isProcessingStaffForgot: false,
    resendTimer: 0,
    handleStaffLogin: vi.fn(),
    handleGoogleLogin: vi.fn(),
    handleCodeLogin: vi.fn(),
    handleForgotPassword: vi.fn(),
    handleVerifyOtp: vi.fn(),
    handleStaffForgotPassword: vi.fn(),
    handleVerifyStaffForgotOtp: vi.fn(),
    handleResetStaffForgotPassword: vi.fn(),
    handleResetPassword: vi.fn(),
    lockoutUntil: null,
    turnstileSiteKey: 'site-key',
    turnstileToken: '',
    setTurnstileToken: vi.fn(),
    turnstileWidgetRef: { current: null },
    isTurnstileReady: false,
    ...overrides,
  };
}

describe('Login Turnstile rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Turnstile widget on the staff login tab', () => {
    vi.mocked(useLoginHandlers).mockReturnValue(loginState() as any);

    render(<Login />);

    expect(screen.getByTestId('turnstile-widget')).toBeInTheDocument();
  });

  it('disables staff login buttons until Turnstile is ready', () => {
    vi.mocked(useLoginHandlers).mockReturnValue(loginState({ isTurnstileReady: false }) as any);

    render(<Login />);

    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
  });

  it('enables staff login buttons after Turnstile is ready', () => {
    vi.mocked(useLoginHandlers).mockReturnValue(
      loginState({ turnstileToken: 'token', isTurnstileReady: true }) as any
    );

    render(<Login />);

    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /continue with google/i })).not.toBeDisabled();
  });

  it('shows a configuration warning instead of the widget when the Turnstile site key is missing', () => {
    vi.mocked(useLoginHandlers).mockReturnValue(
      loginState({
        turnstileSiteKey: '',
        isTurnstileReady: false,
      }) as any
    );

    render(<Login />);

    expect(screen.queryByTestId('turnstile-widget')).not.toBeInTheDocument();
    expect(
      screen.getByText('Bot verification is not configured. Please contact an administrator.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('shows the approved center logo', () => {
    vi.mocked(useLoginHandlers).mockReturnValue(loginState() as any);

    render(<Login />);

    expect(screen.getByRole('img', { name: 'Thiên Uy English Center' })).toHaveAttribute(
      'src',
      CENTER_LOGO_URL
    );
  });
});
