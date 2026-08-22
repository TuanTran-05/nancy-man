// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffPasswordResetRequests from './StaffPasswordResetRequests';
import { apiRequest } from '../../lib/api/apiClient';
import { readChannel } from '../../lib/api/readApi';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  request: {
    id: 'reset-request-1',
    uid: 'staff-uid-1',
    email: 'teacher.teacher@nancy.com',
    displayName: 'Teacher One',
    role: 'teacher',
    status: 'pending',
    createdAt: '2026-06-03T12:00:00.000Z',
    requestedBy: 'staff-uid-1',
  },
}));

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: mocks.apiRequest,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'admin-uid', role: 'admin' } }),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: {},
}));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

describe('StaffPasswordResetRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readChannel).mockResolvedValue({ requests: [mocks.request] });
  });

  it('retrieves and displays the one-time temporary password after approving a staff reset request', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, retrievalToken: 'retrieval-token-1' })
      .mockResolvedValueOnce({ success: true, tempPassword: 'TempPass123!' });

    render(<StaffPasswordResetRequests />);

    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/auth/retrieve-temp-password', {
        method: 'POST',
        body: { token: 'retrieval-token-1' },
      });
    });
    expect(await screen.findByText('TempPass123!')).toBeDefined();
  });
});
