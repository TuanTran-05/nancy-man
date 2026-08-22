// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PrintSupport from './PrintSupport';
import { useAuth } from '../../contexts/AuthContext';
import { cancelPrintRequest, updatePrintRequestStatus } from '../../lib/api/printRequestsApi';
import { readChannel } from '../../lib/api/readApi';
import { readClassesData } from '../../lib/api/frontendReadApi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/api/printRequestsApi', () => ({
  cancelPrintRequest: vi.fn(),
  getPrintRequestFileUrl: vi.fn(),
  updatePrintRequestStatus: vi.fn(),
}));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../../lib/api/frontendReadApi', () => ({
  FRONTEND_READ_POLL_INTERVAL_MS: 15_000,
  readClassesData: vi.fn(),
}));

function renderWithQuery(
  ui: React.ReactElement,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'teacher-1' } },
}));

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function openRequestActions(requestId: string) {
  const row = screen.getByTestId(`print-request-row-${requestId}`);
  fireEvent.click(
    within(row).getByRole('button', { name: /Open actions|Mở thao tác|Mo thao tac/i })
  );
  return row;
}

describe('PrintSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readChannel).mockResolvedValue({ requests: [] });
    vi.mocked(readClassesData).mockResolvedValue({ classes: [] });
  });

  it('shows the teacher create request action', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher One' },
    } as any);

    renderWithQuery(<PrintSupport />);

    expect(
      screen.getByRole('button', { name: /New request|Tạo yêu cầu|Tao yeu cau/i })
    ).toBeInTheDocument();
  });

  it('loads teacher requests from the session-scoped read API when the profile uid is absent', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { uid: 'teacher-1' },
      profile: { role: 'teacher', displayName: 'Teacher One' },
    } as any);

    renderWithQuery(<PrintSupport />);

    await waitFor(() => {
      expect(readChannel).toHaveBeenCalledWith('print-requests', expect.any(Object));
      expect(readClassesData).toHaveBeenCalled();
    });
  });

  it('handles read API failures without rendering stale requests', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { uid: 'teacher-1' },
      profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher One' },
    } as any);

    vi.mocked(readChannel).mockRejectedValue(new Error('forbidden'));
    renderWithQuery(<PrintSupport />);

    await waitFor(() => expect(readChannel).toHaveBeenCalled());
    expect(screen.queryByTestId(/print-request-row-/)).not.toBeInTheDocument();
  });

  it('shows cancel only for pending teacher tickets', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher One' },
    } as any);

    renderWithQuery(
      <PrintSupport
        initialRequestsForTest={
          [
            {
              id: 'print-1',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-1',
              className: 'G5A',
              neededAt: '2026-06-10T09:30:00.000Z',
              neededDate: '2026-06-10',
              createdDate: '2026-06-05',
              status: 'pending',
              files: [],
              createdAt: '2026-06-05T01:00:00.000Z',
            },
            {
              id: 'print-2',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-1',
              className: 'G5A',
              neededAt: '2026-06-11T09:30:00.000Z',
              neededDate: '2026-06-11',
              createdDate: '2026-06-05',
              status: 'printed',
              files: [],
              createdAt: '2026-06-05T02:00:00.000Z',
            },
          ] as any
        }
      />
    );

    const row = openRequestActions('print-1');

    expect(
      within(row).getAllByRole('button', { name: /Cancel request|Hủy yêu cầu|Huy yeu cau/i })
    ).toHaveLength(1);
    expect(screen.queryByTestId('print-actions-print-2')).not.toBeInTheDocument();

    const printedRow = openRequestActions('print-2');
    expect(
      within(printedRow).getByText(
        /No available actions|Không có thao tác khả dụng|Khong co thao tac kha dung/i
      )
    ).toBeInTheDocument();
  });

  it('shows created and needed dates in teacher request rows', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher One' },
    } as any);

    renderWithQuery(
      <PrintSupport
        initialRequestsForTest={
          [
            {
              id: 'print-1',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-1',
              className: 'G5A',
              neededAt: '2026-06-10T09:30:00.000Z',
              neededDate: '2026-06-10',
              createdDate: '2026-06-05',
              status: 'pending',
              files: [],
              createdAt: '2026-06-05T01:00:00.000Z',
            },
          ] as any
        }
      />
    );

    const row = screen.getByTestId('print-request-row-print-1');
    expect(screen.getAllByText(/Ngày gửi|Ngay gui|Created date/i).length).toBeGreaterThan(0);
    expect(within(row).getByText('05/06/2026')).toBeInTheDocument();
    expect(within(row).getByText(/Ngày cần nhận|Ngay can nhan|Needed date/i)).toBeInTheDocument();
    expect(within(row).getByText(/10\/06\/2026/)).toBeInTheDocument();
  });

  it('shows a loading state while a teacher cancels a request', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher One' },
    } as any);
    const cancel = deferred();
    vi.mocked(cancelPrintRequest).mockReturnValue(cancel.promise as any);

    renderWithQuery(
      <PrintSupport
        initialRequestsForTest={
          [
            {
              id: 'print-1',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-1',
              className: 'G5A',
              neededAt: '2026-06-10T09:30:00.000Z',
              neededDate: '2026-06-10',
              createdDate: '2026-06-05',
              status: 'pending',
              files: [],
              createdAt: '2026-06-05T01:00:00.000Z',
            },
          ] as any
        }
      />
    );

    const row = openRequestActions('print-1');
    fireEvent.click(
      within(row).getByRole('button', { name: /Cancel request|Hủy yêu cầu|Huy yeu cau/i })
    );

    expect(
      within(row).getByRole('button', { name: /Cancelling|Đang hủy|Dang huy/i })
    ).toBeDisabled();

    cancel.resolve({ success: true });
    await waitFor(() => expect(cancelPrintRequest).toHaveBeenCalledWith('print-1'));
  });

  it('lets office filter and mark a request printed', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'office-1', role: 'office', displayName: 'Office One' },
    } as any);
    vi.mocked(updatePrintRequestStatus).mockResolvedValue({ success: true } as any);

    renderWithQuery(
      <PrintSupport
        initialRequestsForTest={
          [
            {
              id: 'print-1',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-1',
              className: 'G5A',
              neededAt: '2026-06-10T09:30:00.000Z',
              neededDate: '2026-06-10',
              createdDate: '2026-06-05',
              status: 'pending',
              files: [],
              createdAt: '2026-06-05T01:00:00.000Z',
            },
          ] as any
        }
      />
    );

    fireEvent.change(screen.getByLabelText(/Status|Trạng thái|Trang thai/i), {
      target: { value: 'pending' },
    });
    const row = openRequestActions('print-1');
    fireEvent.click(
      within(row).getByRole('button', { name: /Mark printed|Đã in xong|Da in xong/i })
    );

    await waitFor(() =>
      expect(updatePrintRequestStatus).toHaveBeenCalledWith('print-1', 'printed', '')
    );
  });

  it('renders office requests in the redesigned table ordered by newest request', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'office-1', role: 'office', displayName: 'Office One' },
    } as any);

    renderWithQuery(
      <PrintSupport
        initialRequestsForTest={
          [
            {
              id: 'print-1',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-1',
              className: 'G5A',
              neededAt: '2026-06-10T09:30:00.000Z',
              neededDate: '2026-06-10',
              createdDate: '2026-06-05',
              status: 'pending',
              files: [],
              createdAt: '2026-06-05T01:00:00.000Z',
            },
            {
              id: 'print-2',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-2',
              className: 'G6A',
              neededAt: '2026-06-11T09:30:00.000Z',
              neededDate: '2026-06-11',
              createdDate: '2026-06-05',
              status: 'pending',
              files: [],
              createdAt: '2026-06-05T02:00:00.000Z',
            },
            {
              id: 'print-3',
              teacherId: 'teacher-2',
              teacherName: 'Teacher Two',
              classId: 'class-3',
              className: 'G7A',
              neededAt: '2026-06-12T09:30:00.000Z',
              neededDate: '2026-06-12',
              createdDate: '2026-06-06',
              status: 'printed',
              files: [],
              createdAt: '2026-06-06T01:00:00.000Z',
            },
          ] as any
        }
      />
    );

    const table = screen.getByRole('table', {
      name: /Print request list|Danh s.*y.*u c.*u/i,
    });
    const rows = within(table).getAllByTestId(/print-request-row-/);

    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('G7A')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Teacher Two')).toBeInTheDocument();
    expect(within(rows[1]).getByText('G6A')).toBeInTheDocument();
    expect(within(rows[2]).getByText('G5A')).toBeInTheDocument();
    expect(screen.getByTestId('print-stat-total')).toHaveTextContent('3');
    expect(screen.getByTestId('print-stat-processing')).toHaveTextContent('2');
  });

  it('shows a loading state while office updates a request status', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'office-1', role: 'office', displayName: 'Office One' },
    } as any);
    const update = deferred();
    vi.mocked(updatePrintRequestStatus).mockReturnValue(update.promise as any);

    renderWithQuery(
      <PrintSupport
        initialRequestsForTest={
          [
            {
              id: 'print-1',
              teacherId: 'teacher-1',
              teacherName: 'Teacher One',
              classId: 'class-1',
              className: 'G5A',
              neededAt: '2026-06-10T09:30:00.000Z',
              neededDate: '2026-06-10',
              createdDate: '2026-06-05',
              status: 'pending',
              files: [],
              createdAt: '2026-06-05T01:00:00.000Z',
            },
          ] as any
        }
      />
    );

    const row = openRequestActions('print-1');
    fireEvent.click(
      within(row).getByRole('button', { name: /Mark printed|Đã in xong|Da in xong/i })
    );

    expect(
      within(row).getByRole('button', { name: /Marking printed|Đang cập nhật|Dang cap nhat/i })
    ).toBeDisabled();

    update.resolve({ success: true });
    await waitFor(() =>
      expect(updatePrintRequestStatus).toHaveBeenCalledWith('print-1', 'printed', '')
    );
  });

  it('marks an office request printed immediately and restores it when the update fails', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'office-1', role: 'office', displayName: 'Office One' },
    } as any);
    vi.mocked(readChannel).mockResolvedValue({
      requests: [
        {
            id: 'print-1',
            teacherId: 'teacher-1',
            teacherName: 'Teacher One',
            classId: 'class-1',
            className: 'G5A',
            neededAt: '2026-06-10T09:30:00.000Z',
            neededDate: '2026-06-10',
            createdDate: '2026-06-05',
            status: 'pending',
            files: [],
            createdAt: '2026-06-05T01:00:00.000Z',
        },
      ],
    } as any);
    const update = deferred();
    vi.mocked(updatePrintRequestStatus).mockReturnValue(update.promise as any);

    renderWithQuery(<PrintSupport />);

    await screen.findByTestId('print-request-row-print-1');
    expect(screen.getByTestId('print-stat-processing')).toHaveTextContent('1');
    expect(screen.getByTestId('print-stat-completed')).toHaveTextContent('0');

    const row = openRequestActions('print-1');
    fireEvent.click(
      within(row).getByRole('button', { name: /Mark printed|Đã in xong|Da in xong/i })
    );

    // Immediate feedback, while the request is still in flight.
    await waitFor(() => expect(screen.getByTestId('print-stat-completed')).toHaveTextContent('1'));
    expect(screen.getByTestId('print-stat-processing')).toHaveTextContent('0');

    update.reject(new Error('status update failed'));

    await waitFor(() => expect(screen.getByTestId('print-stat-processing')).toHaveTextContent('1'));
    expect(screen.getByTestId('print-stat-completed')).toHaveTextContent('0');
  });

  it('sends office filters to the read API', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'office-1', role: 'office', displayName: 'Office One' },
    } as any);

    renderWithQuery(<PrintSupport />);

    expect(screen.getByLabelText(/Created date|Ngày gửi|Ngay gui/i)).toHaveAttribute(
      'placeholder',
      'dd/mm/yyyy'
    );
    expect(screen.getByLabelText(/Needed date|Ngày cần nhận|Ngay can nhan/i)).toHaveAttribute(
      'placeholder',
      'dd/mm/yyyy'
    );
    fireEvent.change(screen.getByLabelText(/Needed date|Ngày cần nhận|Ngay can nhan/i), {
      target: { value: '2026-06-10' },
    });
    fireEvent.change(screen.getByLabelText(/Status|Trạng thái|Trang thai/i), {
      target: { value: 'pending' },
    });

    await waitFor(() => {
      expect(readChannel).toHaveBeenCalledWith(
        'print-requests',
        expect.objectContaining({ neededDate: '2026-06-10', status: 'pending' })
      );
    });
  });

  it('only teachers load class references for the create-request form', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'office-1', role: 'office', displayName: 'Office One' },
    } as any);

    const { unmount } = renderWithQuery(<PrintSupport />);
    expect(readClassesData).not.toHaveBeenCalled();
    unmount();
    vi.mocked(readClassesData).mockClear();

    vi.mocked(useAuth).mockReturnValue({
      profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher One' },
    } as any);

    renderWithQuery(<PrintSupport />);
    await waitFor(() => expect(readClassesData).toHaveBeenCalled());
  });
});
