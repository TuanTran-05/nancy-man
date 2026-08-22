// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherAvailability from './TeacherAvailability';
import { apiRequest } from '../../lib/api/apiClient';
import { readChannel } from '../../lib/api/readApi';
import { readClassesData } from '../../lib/api/frontendReadApi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../lib/api/apiClient', () => ({ apiRequest: vi.fn() }));

let role: 'teacher' | 'admin' | 'office' = 'teacher';
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: { uid: role === 'teacher' ? 'teacher-1' : `${role}-1`, role, displayName: role },
  }),
}));

const snapshots: Record<string, any[]> = {};
vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../../lib/api/frontendReadApi', () => ({
  readClassesData: vi.fn(),
}));

function renderWithQuery(
  ui: React.ReactElement,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('TeacherAvailability', () => {
  beforeEach(() => {
    role = 'teacher';
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({ success: true });
    localStorage.setItem('language', 'en');
    snapshots.teacher_availability_slots = [
      {
        id: 'legacy-slot',
        label: 'Legacy slot',
        startTime: '18:00',
        endTime: '19:30',
        active: true,
        allowedPairs: ['tue_thu'],
        sortOrder: 1,
      },
    ];
    snapshots.teacher_availability_profiles = [];
    snapshots.teacher_availability_change_requests = [];
    snapshots.classes = [];
    vi.mocked(readChannel).mockImplementation(async (channel, params: any) => {
      if (channel !== 'teacher-availability') return {} as any;
      if (params?.view === 'profiles') {
        return { profiles: snapshots.teacher_availability_profiles } as any;
      }
      return { requests: snapshots.teacher_availability_change_requests } as any;
    });
    vi.mocked(readClassesData).mockImplementation(async () => ({
      classes: snapshots.classes,
    }));
  });

  it('renders English availability copy from the language module', async () => {
    localStorage.setItem('language', 'en');

    renderWithQuery(<TeacherAvailability />);

    expect(screen.getByText('Teacher Availability')).toBeDefined();
    expect(screen.getByText('Weekly recurring teaching availability.')).toBeDefined();
    expect(screen.getByText('Time slot')).toBeDefined();
    expect(screen.getByText('Mon')).toBeDefined();
    expect(screen.getByText('Sun')).toBeDefined();
    expect(screen.getByText(/Select both days in each pair/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Save availability/i })).toBeDefined();
  });

  it('renders Vietnamese availability copy from the language module', async () => {
    localStorage.setItem('language', 'vi');

    renderWithQuery(<TeacherAvailability />);

    expect(screen.getByText('Lịch rảnh giáo viên')).toBeDefined();
    expect(screen.getByText('Lịch dạy định kỳ hằng tuần.')).toBeDefined();
    expect(screen.getByText('Khung giờ')).toBeDefined();
    expect(screen.getByText('T2')).toBeDefined();
    expect(screen.getByText('CN')).toBeDefined();
    expect(
      screen.getByText(/Chọn cả hai ngày trong từng cặp nếu lịch của bạn đi theo mẫu ngày cặp/i)
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /Lưu lịch rảnh/i })).toBeDefined();
  });

  it('warns teachers to select paired days but still allows saving', async () => {
    renderWithQuery(<TeacherAvailability />);

    expect(screen.getByText('Time slot')).toBeDefined();
    expect(screen.getByText('Mon')).toBeDefined();
    expect(screen.getByText('Sun')).toBeDefined();
    expect(screen.getByText('A1')).toBeDefined();
    expect(screen.getByText('07:30 - 09:45')).toBeDefined();
    expect(screen.getByText(/Select both days in each pair/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Tue C/i }));

    expect(screen.getByRole('button', { name: /Tue C/i })).toHaveTextContent('Available');
    expect(screen.getByRole('button', { name: /Thu C/i })).toHaveTextContent('Busy');

    fireEvent.click(screen.getByRole('button', { name: /Save availability/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/save-availability', {
        method: 'POST',
        body: { selections: [{ dayKey: 'tue', slotId: 'C' }] },
      })
    );
  });

  it('shows a loading state while saving teacher availability', async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    const savePromise = new Promise((resolve) => {
      resolveSave = resolve;
    });
    vi.mocked(apiRequest).mockReturnValue(savePromise as any);

    renderWithQuery(<TeacherAvailability />);

    fireEvent.click(screen.getByRole('button', { name: /Tue C/i }));
    const saveButton = screen.getByRole('button', { name: /Save availability/i });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveButton.getAttribute('aria-busy')).toBe('true');
    });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveTextContent('Saving...');

    resolveSave?.({ success: true });

    await waitFor(() => {
      expect(saveButton.getAttribute('aria-busy')).toBe('false');
    });
    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toHaveTextContent('Save availability');
  });

  it('requires a reason before submitting changes after first save', async () => {
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-1',
        teacherId: 'teacher-1',
        teacherName: 'Teacher',
        selections: [],
        selectionKeys: [],
        version: 1,
      },
    ];
    renderWithQuery(<TeacherAvailability />);

    const submitButton = await screen.findByRole('button', { name: /Submit for review/i });
    fireEvent.click(screen.getByRole('button', { name: /Tue C/i }));
    fireEvent.click(screen.getByRole('button', { name: /Thu C/i }));
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Reason is required/i)).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('lets admin approve a pending request', async () => {
    role = 'admin';
    snapshots.teacher_availability_change_requests = [
      {
        id: 'request-1',
        teacherId: 'teacher-1',
        teacherName: 'Teacher One',
        currentSelections: [],
        requestedSelections: [{ dayKey: 'tue', slotId: 'C' }],
        reason: 'Available now',
        status: 'pending',
        createdAt: '2026-06-02T00:00:00.000Z',
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    const approveBtn = await screen.findByRole('button', { name: /Approve/i });
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/review-availability-change', {
        method: 'POST',
        body: { requestId: 'request-1', decision: 'approved', reviewNote: '' },
      })
    );
  });

  it('shows loading only on the active review action', async () => {
    role = 'admin';
    snapshots.teacher_availability_change_requests = [
      {
        id: 'request-1',
        teacherId: 'teacher-1',
        teacherName: 'Teacher One',
        currentSelections: [],
        requestedSelections: [{ dayKey: 'tue', slotId: 'C' }],
        reason: 'Available now',
        status: 'pending',
        createdAt: '2026-06-02T00:00:00.000Z',
      },
    ];
    let resolveReview: ((value: unknown) => void) | undefined;
    const reviewPromise = new Promise((resolve) => {
      resolveReview = resolve;
    });
    vi.mocked(apiRequest).mockReturnValue(reviewPromise as any);

    renderWithQuery(<TeacherAvailability />);

    const approveButton = await screen.findByRole('button', { name: /Approve/i });
    const rejectButton = screen.getByRole('button', { name: /Reject/i });

    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(approveButton.getAttribute('aria-busy')).toBe('true');
    });
    expect(approveButton).toBeDisabled();
    expect(approveButton).toHaveTextContent('Approving...');
    expect(rejectButton.getAttribute('aria-busy')).toBe('false');
    expect(rejectButton).toBeDisabled();
    expect(rejectButton).toHaveTextContent('Reject');

    resolveReview?.({ success: true });

    await waitFor(() => {
      expect(approveButton.getAttribute('aria-busy')).toBe('false');
    });
    expect(approveButton).not.toBeDisabled();
    expect(rejectButton).not.toBeDisabled();
    expect(approveButton).toHaveTextContent('Approve');
  });

  it('groups approved availability by day for office users', async () => {
    role = 'office';
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-1',
        teacherId: 'teacher-1',
        teacherName: 'Mr. Tuan Tran',
        selections: [{ dayKey: 'wed', slotId: 'C' }],
        selectionKeys: ['wed:C'],
        version: 1,
      },
      {
        id: 'teacher-2',
        teacherId: 'teacher-2',
        teacherName: 'Mrs. Huong',
        selections: [
          { dayKey: 'wed', slotId: 'D' },
          { dayKey: 'sat', slotId: 'A1' },
        ],
        selectionKeys: ['wed:D', 'sat:A1'],
        version: 1,
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    expect(await screen.findByText('Approved availability')).toBeDefined();
    expect(screen.getByText('Day')).toBeDefined();
    expect(
      (await screen.findAllByRole('button', { name: /Mr. Tuan Tran/i })).length
    ).toBeGreaterThan(0);
    const huongButtons = await screen.findAllByRole('button', { name: /Mrs. Huong/i });
    expect(huongButtons.length).toBeGreaterThan(0);

    fireEvent.click(huongButtons[0]);

    expect(screen.getByText('Mrs. Huong availability')).toBeDefined();
  });

  it('lets office users select teachers who saved no available slots', async () => {
    role = 'office';
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-available',
        teacherId: 'teacher-available',
        teacherName: 'Alpha Available',
        selections: [{ dayKey: 'wed', slotId: 'C' }],
        selectionKeys: ['wed:C'],
        version: 1,
      },
      {
        id: 'teacher-busy',
        teacherId: 'teacher-busy',
        teacherName: 'Zed Busy',
        selections: [],
        selectionKeys: [],
        version: 1,
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    const busyTeacherButton = await screen.findByRole('button', { name: /Zed Busy/i });
    fireEvent.click(busyTeacherButton);

    expect(screen.getByText('Zed Busy availability')).toBeDefined();
    expect(screen.getAllByText('Busy').length).toBeGreaterThan(0);
  });

  it('renders reviewer availability cells as available, busy, and teaching badges', async () => {
    role = 'office';
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-1',
        teacherId: 'teacher-1',
        teacherName: 'Mr. Tuan Tran',
        selections: [{ dayKey: 'wed', slotId: 'D' }],
        selectionKeys: ['wed:D'],
        version: 1,
      },
    ];
    snapshots.classes = [
      {
        id: 'class-1',
        name: 'Advanced 7',
        schedule: '17:00 - 18:30',
        daysOfWeek: [3],
        description: '',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        startTime: '17:00',
        teacherId: 'teacher-1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    expect(await screen.findByText('Mr. Tuan Tran availability')).toBeDefined();
    expect(await screen.findByText('Teaching Advanced 7')).toBeDefined();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Busy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('does not show slot setup controls for office users', async () => {
    role = 'office';
    renderWithQuery(<TeacherAvailability />);

    await screen.findByText('Teacher Availability');
    expect(screen.queryByText('Slot configuration')).toBeNull();
    expect(screen.queryByLabelText(/Slot label/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Save slot/i })).toBeNull();
  });

  it('renders Vietnamese busy class notes for office users', async () => {
    localStorage.setItem('language', 'vi');
    role = 'office';
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-1',
        teacherId: 'teacher-1',
        teacherName: 'Mr. Tuan Tran',
        selections: [{ dayKey: 'wed', slotId: 'C' }],
        selectionKeys: ['wed:C'],
        version: 1,
      },
    ];
    snapshots.classes = [
      {
        id: 'class-1',
        name: 'Advanced 7',
        schedule: '17:00 - 18:30',
        daysOfWeek: [3],
        description: '',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        startTime: '17:00',
        teacherId: 'teacher-1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    expect(await screen.findByText('Lịch rảnh đã duyệt')).toBeDefined();
    expect(await screen.findByText('Đã có lớp: Advanced 7 - 17:00 - 18:30')).toBeDefined();
  });

  it('shows busy class name and time next to a teacher for office users', async () => {
    role = 'office';
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-1',
        teacherId: 'teacher-1',
        teacherName: 'Mr. Tuan Tran',
        selections: [{ dayKey: 'wed', slotId: 'C' }],
        selectionKeys: ['wed:C'],
        version: 1,
      },
    ];
    snapshots.classes = [
      {
        id: 'class-1',
        name: 'Advanced 7',
        schedule: '17:00 - 18:30',
        daysOfWeek: [3],
        description: '',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        startTime: '17:00',
        teacherId: 'teacher-1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    expect((await screen.findAllByText('Mr. Tuan Tran')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Already has class: Advanced 7 - 17:00 - 18:30')).toBeDefined();
  });

  it('joins multiple busy classes in one note separated by semicolons', async () => {
    role = 'office';
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-1',
        teacherId: 'teacher-1',
        teacherName: 'Mr. Tuan Tran',
        selections: [
          { dayKey: 'wed', slotId: 'C' },
          { dayKey: 'wed', slotId: 'D' },
        ],
        selectionKeys: ['wed:C', 'wed:D'],
        version: 1,
      },
    ];
    snapshots.classes = [
      {
        id: 'class-b',
        name: 'Beta',
        schedule: '19:00 - 20:30',
        daysOfWeek: [3],
        description: '',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        startTime: '19:00',
        teacherId: 'teacher-1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'class-a',
        name: 'Alpha',
        schedule: '17:00 - 18:30',
        daysOfWeek: [3],
        description: '',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        startTime: '17:00',
        teacherId: 'teacher-1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    expect(
      await screen.findByText('Already has class: Alpha - 17:00 - 18:30; Beta - 19:00 - 20:30')
    ).toBeDefined();
  });

  it('keeps name-only teacher buttons when no class overlaps selected availability', async () => {
    role = 'office';
    snapshots.teacher_availability_profiles = [
      {
        id: 'teacher-1',
        teacherId: 'teacher-1',
        teacherName: 'Mr. Tuan Tran',
        selections: [{ dayKey: 'wed', slotId: 'C' }],
        selectionKeys: ['wed:C'],
        version: 1,
      },
    ];
    snapshots.classes = [
      {
        id: 'class-1',
        name: 'Morning Class',
        schedule: '09:00 - 10:30',
        daysOfWeek: [3],
        description: '',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        startTime: '09:00',
        teacherId: 'teacher-1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    renderWithQuery(<TeacherAvailability />);

    expect(
      (await screen.findAllByRole('button', { name: /Mr. Tuan Tran/i })).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Already has class:/i)).toBeNull();
  });

  it('loads availability and classes through the same session-scoped read channels for each role', async () => {
    role = 'office';
    const { unmount } = renderWithQuery(<TeacherAvailability />);
    await screen.findByText('Teacher Availability');
    await waitFor(() => expect(readChannel).toHaveBeenCalledTimes(2));
    expect(readClassesData).toHaveBeenCalledTimes(1);
    unmount();
    vi.mocked(readChannel).mockClear();
    vi.mocked(readClassesData).mockClear();

    role = 'teacher';
    renderWithQuery(<TeacherAvailability />);
    await screen.findByText('Teacher Availability');
    await waitFor(() => expect(readChannel).toHaveBeenCalledTimes(2));
    expect(readClassesData).toHaveBeenCalledTimes(1);
  });
});
