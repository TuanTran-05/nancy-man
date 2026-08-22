// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import Admissions from './Admissions';
import {
  createTrialAdmission,
  readRecentAdmissions,
  searchHistoricalAdmissions,
  addToWaitlist,
  deletePendingStudent,
  listPendingStudents,
} from '../../lib/admissions/admissionsApi';
import { readClassesData } from '../../lib/api/frontendReadApi';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/admissions/admissionsApi', () => ({
  createTrialAdmission: vi.fn(),
  addToWaitlist: vi.fn(),
  deletePendingStudent: vi.fn(),
  listPendingStudents: vi.fn().mockResolvedValue({ students: [] }),
  searchHistoricalAdmissions: vi.fn().mockResolvedValue({ exactMatches: [], possibleMatches: [] }),
  readRecentAdmissions: vi
    .fn()
    .mockResolvedValue({ admissions: [], page: { limit: 10, nextCursor: null, hasMore: false } }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'test-user-office', role: 'office' } }),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'test-user-office' } },
}));

vi.mock('../../lib/api/frontendReadApi', () => ({
  readClassesData: vi.fn(),
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('Admissions page', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(listPendingStudents).mockResolvedValue({ students: [] });
    vi.mocked(searchHistoricalAdmissions).mockResolvedValue({
      exactMatches: [],
      possibleMatches: [],
    });
    vi.mocked(readRecentAdmissions).mockResolvedValue({
      admissions: [],
      page: { limit: 10, nextCursor: null, hasMore: false },
    });
    vi.mocked(readClassesData).mockResolvedValue({
      classes: [
        { id: 'class-1', name: 'E101', teacherId: 'teacher-1', status: 'active', grade: 6 },
      ],
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('submits a waiting list form', async () => {
    vi.mocked(addToWaitlist).mockResolvedValue({
      mode: 'added',
      studentId: 'student-1',
      studentCode: 'HS260001',
    });

    render(<Admissions />, { wrapper: createWrapper(queryClient) });

    fireEvent.change(screen.getByLabelText(/Student name/i), {
      target: { value: 'Nguyen Van A' },
    });
    fireEvent.change(screen.getByLabelText(/Date of birth/i), {
      target: { value: '2014-01-01' },
    });
    fireEvent.change(screen.getByLabelText(/Grade/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '0384072314' } });
    fireEvent.change(screen.getByLabelText(/Placement note/i), {
      target: { value: 'Wants grade 6 evening class' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add to Waitlist/i }));

    await waitFor(() => {
      expect(addToWaitlist).toHaveBeenCalledWith({
        name: 'NGUYEN VAN A',
        dob: '2014-01-01',
        grade: 6,
        contact: '0384072314',
        note: 'Wants grade 6 evening class',
      });
    });
  });

  it('shows waitlist notes for placement context', async () => {
    vi.mocked(listPendingStudents).mockResolvedValue({
      students: [
        {
          id: 'pending-1',
          name: 'Pending Student',
          studentId: 'HS260099',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          note: 'Wants grade 6 evening class',
          createdAt: '2026-06-02T08:00:00.000Z',
        },
      ],
    });

    render(<Admissions />, { wrapper: createWrapper(queryClient) });

    expect(await screen.findByText('Wants grade 6 evening class')).toBeDefined();
  });

  it('keeps the waitlist note visible when creating a trial placement', async () => {
    vi.mocked(listPendingStudents).mockResolvedValue({
      students: [
        {
          id: 'pending-1',
          name: 'Pending Student',
          studentId: 'HS260099',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          note: 'Wants grade 6 evening class',
          createdAt: '2026-06-02T08:00:00.000Z',
        },
      ],
    });

    render(<Admissions />, { wrapper: createWrapper(queryClient) });

    fireEvent.click(await screen.findByRole('button', { name: /Create Trial/i }));

    expect(screen.getByLabelText(/Waitlist placement note/i)).toHaveTextContent(
      'Wants grade 6 evening class'
    );
  });

  it('asks for a join date before creating a trial in an ended class', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    localStorage.setItem('language', 'vi');
    vi.mocked(listPendingStudents).mockResolvedValue({
      students: [
        {
          id: 'pending-1',
          name: 'Pending Student',
          studentId: 'HS260099',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          note: '',
          createdAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
    vi.mocked(readClassesData).mockResolvedValue({
      classes: [
        {
          id: 'class-ended',
          name: 'E101',
          teacherId: 'teacher-1',
          status: 'active',
          grade: 6,
          startDate: '2026-01-05',
          endDate: '2026-03-31',
        },
      ],
    } as any);
    vi.mocked(createTrialAdmission).mockResolvedValue({
      mode: 'created',
      studentId: 'pending-1',
      studentCode: 'HS260099',
      trialReviewStatus: 'pending_sessions',
    });

    render(<Admissions />, { wrapper: createWrapper(queryClient) });
    fireEvent.click(await screen.findByRole('button', { name: /Create Trial/i }));
    fireEvent.change(screen.getByLabelText(/Choose class for trial/i), {
      target: { value: 'class-ended' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Trial Placement/i }));

    expect(await screen.findByText('Lớp đã kết khóa')).toBeTruthy();
    expect(createTrialAdmission).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Khóa hiện tại/ }));
    fireEvent.change(screen.getByLabelText('Ngày vào học'), {
      target: { value: '2026-02-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() =>
      expect(createTrialAdmission).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingStudentId: 'pending-1',
          classId: 'class-ended',
          joinedAt: '2026-02-10',
        })
      )
    );
  });

  it('shows exact and possible matches with the recent admissions timeline', async () => {
    vi.mocked(readRecentAdmissions).mockResolvedValue({
      admissions: [
        {
          id: 'history-1',
          action: 'created_trial',
          studentName: 'Recent Trial',
          className: 'E101',
          trialSessionCount: 1,
          trialRequiredSessions: 2,
          trialReviewStatus: 'pending_sessions',
          studentLifecycle: 'trial',
        },
      ],
      page: {
        limit: 10,
        nextCursor: null,
        hasMore: false,
      },
    });
    vi.mocked(searchHistoricalAdmissions).mockResolvedValue({
      exactMatches: [
        {
          id: 'exact-1',
          data: {
            name: 'Exact Student',
            studentId: 'HS260001',
            enrollmentStatus: 'active',
            studentLifecycle: 'enrolled',
          },
          reasons: ['name', 'dob', 'contact'],
          latestClassId: 'class-1',
          latestClassName: 'E101',
        },
      ],
      possibleMatches: [
        {
          id: 'possible-1',
          data: {
            name: 'Possible Student',
            studentId: 'HS240099',
            enrollmentStatus: 'dropped',
            studentLifecycle: 'archived',
          },
          reasons: ['name', 'contact'],
          latestClassId: 'class-old',
          latestClassName: 'Old E101',
        },
      ],
    });

    render(<Admissions />, { wrapper: createWrapper(queryClient) });

    await waitFor(() => expect(readRecentAdmissions).toHaveBeenCalled());

    // Switch to Admissions Timeline tab to render recent admissions
    fireEvent.click(screen.getByRole('button', { name: /Admissions Timeline/i }));

    expect(await screen.findByText('Recent Trial')).toBeDefined();
    expect(screen.getByText(/1\/2/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Student name/i), {
      target: { value: 'Nguyen Van A' },
    });
    fireEvent.change(screen.getByLabelText(/Date of birth/i), {
      target: { value: '2014-01-01' },
    });
    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '0384072314' } });
    fireEvent.click(screen.getByRole('button', { name: /Search history/i }));

    expect(await screen.findByText('Exact Student')).toBeDefined();
    expect(await screen.findByText('Active')).toBeDefined();
    expect(await screen.findByText('Latest class: E101')).toBeDefined();
    expect(await screen.findByText('Possible Student')).toBeDefined();
    expect(await screen.findByText('Archived')).toBeDefined();
    expect(await screen.findByText('Latest class: Old E101')).toBeDefined();
  });

  it('reuses cache on remount and performs zero new pending or first-history reads', async () => {
    vi.mocked(listPendingStudents).mockResolvedValue({
      students: [{ id: 'p1', name: 'Pending One' } as any],
    });
    vi.mocked(readRecentAdmissions).mockResolvedValue({
      admissions: [{ id: 'h1', studentName: 'History One' } as any],
      page: { limit: 10, nextCursor: null, hasMore: false },
    });

    const wrapper = createWrapper(queryClient);
    const { unmount } = render(<Admissions />, { wrapper });

    await waitFor(() => expect(listPendingStudents).toHaveBeenCalledTimes(1));
    expect(readRecentAdmissions).toHaveBeenCalledTimes(1);
    expect(readClassesData).toHaveBeenCalledTimes(1);

    unmount();

    render(<Admissions />, { wrapper });
    await waitFor(() => expect(screen.getByText('Pending One')).toBeDefined());

    expect(listPendingStudents).toHaveBeenCalledTimes(1);
    expect(readRecentAdmissions).toHaveBeenCalledTimes(1);
    expect(readClassesData).toHaveBeenCalledTimes(1);
  });

  it('loads cursor-keyed second page and preserves pending search client-side', async () => {
    vi.mocked(listPendingStudents).mockResolvedValue({
      students: [{ id: 'p1', name: 'Alice' } as any, { id: 'p2', name: 'Bob' } as any],
    });
    vi.mocked(readRecentAdmissions)
      .mockResolvedValueOnce({
        admissions: [{ id: 'h1', studentName: 'History One' } as any],
        page: { limit: 10, nextCursor: 'cursor-page-2', hasMore: true },
      })
      .mockResolvedValueOnce({
        admissions: [{ id: 'h2', studentName: 'History Two' } as any],
        page: { limit: 10, nextCursor: null, hasMore: false },
      });

    const wrapper = createWrapper(queryClient);
    render(<Admissions />, { wrapper });

    await screen.findByText('Alice');

    // Searching in waitlist doesn't perform network reads
    const searchInput = screen.getByPlaceholderText('Quick search waiting...');
    fireEvent.change(searchInput, { target: { value: 'Ali' } });
    expect(listPendingStudents).toHaveBeenCalledTimes(1);

    // Switch to history and load more
    fireEvent.click(screen.getByRole('button', { name: /Admissions Timeline/i }));
    await screen.findByText('History One');

    const loadMoreBtn = await screen.findByRole('button', { name: /Load More/i });
    fireEvent.click(loadMoreBtn);

    await screen.findByText('History Two');
    expect(readRecentAdmissions).toHaveBeenNthCalledWith(2, 10, 'cursor-page-2');
  });

  it('rolls back optimistic delete on rejection', async () => {
    vi.mocked(listPendingStudents).mockResolvedValue({
      students: [{ id: 'p1', name: 'Pending Delete' } as any],
    });
    vi.mocked(deletePendingStudent).mockRejectedValueOnce(new Error('Network failure'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const wrapper = createWrapper(queryClient);
    render(<Admissions />, { wrapper });

    await screen.findByText('Pending Delete');
    const deleteBtn = screen.getByTitle('Remove from waitlist');
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(deletePendingStudent).toHaveBeenCalledWith('p1'));
    // Rolled back
    await screen.findByText('Pending Delete');
  });
});
