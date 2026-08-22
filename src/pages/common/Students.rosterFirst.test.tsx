// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';

import Students from './Students';
import {
  useStudentDirectoryData,
  type StudentDirectoryData,
} from '../../lib/student/useStudentDirectoryData';

vi.mock('../../lib/student/useStudentDirectoryData', () => ({
  useStudentDirectoryData: vi.fn(),
}));

// The embedded monthly report is the heaviest read on this page: one
// `reports-monthly` request fans out across seven collections server-side.
// Standing in for it here lets the test say when it is allowed to mount.
vi.mock('./Reports', () => ({
  default: () => <div data-testid="embedded-reports" />,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'admin-1' },
    profile: { uid: 'admin-1', role: 'admin', displayName: 'Admin' },
    loading: false,
  }),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'vi' }),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'admin-1' } },
  db: {},
}));

vi.mock('../../lib/student/faceImage', () => ({
  isStudentFaceStoragePath: () => false,
  resolveStudentFaceUrl: vi.fn().mockResolvedValue(''),
}));

vi.mock('./components/students/StudentActionModals', () => ({
  useStudentActionModals: () => ({
    controller: {
      openCreate: vi.fn(),
      openEdit: vi.fn(),
      openStatus: vi.fn(),
      openTransfer: vi.fn(),
      openDelete: vi.fn(),
    },
    modals: null,
    isAnyOpen: false,
  }),
}));

vi.mock('../../components/students/StudentImportModal', () => ({
  StudentImportModal: () => null,
}));

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

function directoryStub(overrides: Partial<StudentDirectoryData> = {}): StudentDirectoryData {
  return {
    students: [],
    classes: [],
    teachers: [],
    parentProfiles: [],
    parentProfilesLoaded: true,
    ledgers: [],
    gradedSubmissions: [],
    loading: false,
    loadingRemainingStudents: false,
    loadingDetails: false,
    loadingMore: false,
    error: null,
    paginationMode: 'client',
    hasMoreServer: false,
    loadMoreServer: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

function renderStudents() {
  const result = render(
    <MemoryRouter>
      <Students />
    </MemoryRouter>
  );
  return {
    ...result,
    rerenderStudents: () =>
      result.rerender(
        <MemoryRouter>
          <Students />
        </MemoryRouter>
      ),
  };
}

const REPORTS_PANEL_STORAGE_KEY = 'edutrack:students-reports-open:admin-1';
const REPORTS_TOGGLE_NAME = 'Báo cáo & Thống kê';

beforeEach(() => {
  vi.mocked(useStudentDirectoryData).mockReset();
  window.localStorage.clear();
});

describe('Students roster-first rendering', () => {
  it('shows a table skeleton while the first student page is loading', () => {
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub({ loading: true }));

    renderStudents();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getAllByTestId('student-loading-skeleton')).toHaveLength(6);
    expect(screen.getAllByTestId('student-kpi-skeleton')).toHaveLength(4);
  });

  it('keeps loaded rows visible while the rest of the roster downloads', () => {
    vi.mocked(useStudentDirectoryData).mockReturnValue(
      directoryStub({
        students: [
          {
            id: 'student-1',
            studentId: 'HS001',
            name: 'Nguyen Van A',
            classId: 'class-1',
          } as any,
        ],
        loadingRemainingStudents: true,
      })
    );

    renderStudents();

    expect(screen.getByText('HS001')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1');
    expect(screen.queryByTestId('student-loading-skeleton')).not.toBeInTheDocument();
  });

  it('leaves the reports panel unmounted until the section is expanded', () => {
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub());

    renderStudents();

    expect(screen.getByRole('button', { name: REPORTS_TOGGLE_NAME })).toBeInTheDocument();
    expect(screen.queryByTestId('embedded-reports')).not.toBeInTheDocument();
  });

  it('mounts the reports panel when the section is expanded', () => {
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub());
    renderStudents();

    fireEvent.click(screen.getByRole('button', { name: REPORTS_TOGGLE_NAME }));

    expect(screen.getByTestId('embedded-reports')).toBeInTheDocument();
  });

  it('unmounts the reports panel when the section is collapsed again', () => {
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub());
    renderStudents();
    const toggle = screen.getByRole('button', { name: REPORTS_TOGGLE_NAME });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.queryByTestId('embedded-reports')).not.toBeInTheDocument();
  });

  it('restores a remembered expanded section on the next visit', () => {
    window.localStorage.setItem(REPORTS_PANEL_STORAGE_KEY, 'true');
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub());

    renderStudents();

    expect(screen.getByTestId('embedded-reports')).toBeInTheDocument();
  });

  it('holds a remembered expanded section back until the roster has painted', () => {
    window.localStorage.setItem(REPORTS_PANEL_STORAGE_KEY, 'true');
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub({ loading: true }));
    const { rerenderStudents } = renderStudents();

    expect(screen.queryByTestId('embedded-reports')).not.toBeInTheDocument();

    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub({ loading: false }));
    rerenderStudents();

    expect(screen.getByTestId('embedded-reports')).toBeInTheDocument();
  });

  it('keeps the reports panel mounted while a later refresh reloads the roster', () => {
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub());
    const { rerenderStudents } = renderStudents();
    fireEvent.click(screen.getByRole('button', { name: REPORTS_TOGGLE_NAME }));

    // A refresh flips the directory back to loading. Unmounting the panel here
    // would throw away a resolved `reports-monthly` result and pay for it again.
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub({ loading: true }));
    rerenderStudents();

    expect(screen.getByTestId('embedded-reports')).toBeInTheDocument();
  });
});

describe('Students manual roster refresh', () => {
  it('refetches the roster when the refresh button is clicked', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub({ refresh }));

    renderStudents();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores a second click while a refresh is still in flight', async () => {
    let settleRefresh: () => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settleRefresh = resolve;
        })
    );
    vi.mocked(useStudentDirectoryData).mockReturnValue(directoryStub({ refresh }));

    renderStudents();
    const button = screen.getByRole('button', { name: 'Làm mới' });
    fireEvent.click(button);
    fireEvent.click(button);

    // Each roster refresh re-runs the full student pagination plus the ledger
    // and submission bulk reads, so a double click must not double the cost.
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleRefresh();
    });
  });
});
