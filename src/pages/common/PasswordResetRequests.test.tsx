// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PasswordResetRequests from './PasswordResetRequests';
import { readChannel } from '../../lib/api/readApi';
import {
  clearPasswordResetSnapshot,
  setPasswordResetSnapshot,
} from '../../lib/password-reset/passwordResetSnapshot';
import type { PasswordResetRequest } from '../../types';
import React from 'react';

const TEACHER_ONE = { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher 1' };
const TEACHER_TWO = { uid: 'teacher-2', role: 'teacher', displayName: 'Teacher 2' };

let currentProfile: typeof TEACHER_ONE = TEACHER_ONE;

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: currentProfile }),
}));

vi.mock('../../lib/api/apiClient', () => ({ apiRequest: vi.fn() }));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'teacher-1' } },
}));

function request(overrides: Partial<PasswordResetRequest> = {}): PasswordResetRequest {
  return {
    id: 'req-1',
    userId: 'student-1',
    studentDocId: 'doc-1',
    type: 'student',
    teacherId: 'teacher-1',
    studentName: 'Nguyen Van A',
    phoneNumber: '0901234567',
    status: 'pending',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PasswordResetRequests', () => {
  beforeEach(() => {
    clearPasswordResetSnapshot();
    currentProfile = TEACHER_ONE;
    vi.clearAllMocks();
    vi.mocked(readChannel).mockResolvedValue({ requests: [] });
    localStorage.setItem('language', 'en');
  });

  it('renders loading state initially when no snapshot exists', () => {
    vi.mocked(readChannel).mockReturnValue(new Promise(() => undefined));
    render(<PasswordResetRequests />);
    expect(readChannel).toHaveBeenCalledWith('password-reset-requests', expect.any(Object));
    expect(screen.queryByText('No requests found')).not.toBeInTheDocument();
  });

  it('renders snapshot data immediately on remount without waiting for listener', () => {
    setPasswordResetSnapshot(TEACHER_ONE, [request()]);

    render(<PasswordResetRequests />);

    expect(screen.getByText('Nguyen Van A')).toBeInTheDocument();
    expect(screen.getByText('0901234567')).toBeInTheDocument();
  });

  it('renders a known empty snapshot without the loader', () => {
    setPasswordResetSnapshot(TEACHER_ONE, []);

    render(<PasswordResetRequests />);

    expect(screen.getByText('No requests found')).toBeInTheDocument();
  });

  it('updates state and snapshot when the read API returns fresh data', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      requests: [request({ id: 'req-2', studentName: 'Tran Van B', phoneNumber: '0987654321' })],
    });
    render(<PasswordResetRequests />);

    await waitFor(() => {
      expect(screen.getByText('Tran Van B')).toBeInTheDocument();
    });
    expect(readChannel).toHaveBeenCalledWith('password-reset-requests', expect.any(Object));
  });

  it('never renders the previous account rows after an identity switch', async () => {
    vi.mocked(readChannel).mockResolvedValueOnce({ requests: [request()] });
    const first = render(<PasswordResetRequests />);

    await waitFor(() => expect(screen.getByText('Nguyen Van A')).toBeInTheDocument());
    first.unmount();

    currentProfile = TEACHER_TWO;
    vi.mocked(readChannel).mockReturnValueOnce(new Promise(() => undefined));
    render(<PasswordResetRequests />);

    expect(screen.queryByText('Nguyen Van A')).not.toBeInTheDocument();
    expect(screen.queryByText('0901234567')).not.toBeInTheDocument();
  });

  it('keeps each account snapshot separate across a switch back', async () => {
    setPasswordResetSnapshot(TEACHER_ONE, [request({ studentName: 'Nguyen Van A' })]);
    setPasswordResetSnapshot(TEACHER_TWO, [
      request({ id: 'req-9', teacherId: 'teacher-2', studentName: 'Le Thi C' }),
    ]);

    currentProfile = TEACHER_TWO;
    const second = render(<PasswordResetRequests />);
    expect(screen.getByText('Le Thi C')).toBeInTheDocument();
    expect(screen.queryByText('Nguyen Van A')).not.toBeInTheDocument();
    second.unmount();

    currentProfile = TEACHER_ONE;
    render(<PasswordResetRequests />);
    expect(screen.getByText('Nguyen Van A')).toBeInTheDocument();
    expect(screen.queryByText('Le Thi C')).not.toBeInTheDocument();
  });
});
