// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../lib/api/readApi';
import { AuthProvider, useAuth } from './AuthContext';

const session = vi.hoisted(() => ({
  listener: null as null | ((user: any) => void),
  currentUser: null as any,
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../lib/auth/sessionAuth', () => ({
  auth: {
    get currentUser() {
      return session.currentUser;
    },
    subscribe: vi.fn((listener: (user: any) => void) => {
      session.listener = listener;
      return () => {
        session.listener = null;
      };
    }),
    refresh: session.refresh,
    signOut: session.signOut,
  },
}));
vi.mock('../lib/api/readApi', () => ({ readChannel: vi.fn() }));

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="role">{auth.profile?.role || ''}</span>
      <span data-testid="name">{auth.profile?.displayName || ''}</span>
      <span data-testid="phone">{auth.profile?.phone || ''}</span>
      <span data-testid="ready">{String(auth.isAuthReady)}</span>
      <button onClick={() => auth.updateProfileState({ displayName: 'Updated' })}>update</button>
      <button onClick={() => void auth.signOut()}>logout</button>
    </div>
  );
}

describe('AuthProvider session integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    session.listener = null;
    session.currentUser = null;
    session.refresh.mockResolvedValue(null);
    session.signOut.mockResolvedValue(undefined);
    vi.mocked(readChannel).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the server session when the app mounts after a tab reload', async () => {
    const restoredUser = {
      uid: 'teacher-1',
      email: 'teacher@example.com',
      displayName: 'Teacher One',
      role: 'teacher',
      studentId: null,
      providerData: [],
    };
    session.refresh.mockImplementationOnce(async () => {
      session.currentUser = restoredUser;
      session.listener?.(restoredUser);
      return restoredUser;
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('teacher'));
    expect(screen.getByTestId('name')).toHaveTextContent('Teacher One');
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  });

  it('builds the staff profile directly from the PostgreSQL session response', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    const user = {
      uid: 'office-1',
      email: 'office@example.com',
      displayName: 'Office User',
      role: 'office',
      studentId: null,
      forcePasswordChange: false,
      phone: '84384072314',
      providerData: [],
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
    };
    session.currentUser = user;
    act(() => session.listener?.(user));

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(screen.getByTestId('role')).toHaveTextContent('office');
    expect(screen.getByTestId('name')).toHaveTextContent('Office User');
    expect(screen.getByTestId('phone')).toHaveTextContent('84384072314');
    expect(readChannel).not.toHaveBeenCalled();
  });

  it('loads the linked student projection for student sessions', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      students: [{ id: 'student-row', name: 'Student Name', classId: 'class-1' }],
    } as any);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    const user = {
      uid: 'student:student-row',
      email: null,
      displayName: 'Student',
      role: 'student',
      studentId: 'student-row',
      forcePasswordChange: false,
      providerData: [],
      emailVerified: false,
      isAnonymous: false,
      tenantId: null,
    };
    session.currentUser = user;
    act(() => session.listener?.(user));

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Student Name'));
    expect(readChannel).toHaveBeenCalledWith('students', { view: 'session' });
  });

  it('updates safe cached fields and signs out through the session client', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    const user = {
      uid: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      providerData: [],
    };
    session.currentUser = user;
    act(() => session.listener?.(user));
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));

    fireEvent.click(screen.getByText('update'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Updated'));
    expect(localStorage.getItem('edu_user_displayName')).toBe('Updated');
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(session.signOut).toHaveBeenCalledTimes(1));
  });

  it('clears the active profile when the periodic session check expires', async () => {
    vi.useFakeTimers();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    const user = {
      uid: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      providerData: [],
    };
    session.currentUser = user;
    act(() => session.listener?.(user));
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('role')).toHaveTextContent('admin');

    session.refresh.mockImplementationOnce(async () => {
      session.currentUser = null;
      session.listener?.(null);
      return null;
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(session.refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('role')).toHaveTextContent('');
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  });
});
