// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));

vi.mock('../../../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'admin-1' } },
}));

vi.mock('../../../../lib/api/apiClient', () => ({
  apiRequest: apiRequestMock,
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: { div: (p: any) => <div {...p} /> },
}));

vi.mock('../../../../components/common/ModalPortal', () => ({
  ModalPortal: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../hooks/useCameraCapture', () => ({
  useCameraCapture: () => ({
    videoRef: { current: null },
    isCameraActive: false,
    stream: null,
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    capturePhoto: vi.fn(),
  }),
}));

import { useStudentActionModals } from './StudentActionModals';

const T = {
  close: 'Close',
  modal: {
    addTitle: 'Thêm học sinh',
    editTitle: 'Sửa học sinh',
    faceLabel: 'Ảnh',
    nameLabel: 'Tên',
    namePlaceholder: 'Tên',
    idLabel: 'Mã',
    idPlaceholder: 'Mã',
    dobLabel: 'Ngày sinh',
    contactLabel: 'Liên hệ',
    contactPlaceholder: 'Số điện thoại',
    classLabel: 'Lớp',
    codeLabel: 'Code',
    codePlaceholder: 'Code',
    openCamera: 'Camera',
    takePhoto: 'Chụp',
    save: 'Lưu',
  },
  gradeOption: 'Lớp {grade}',
  gradeSuggestion: 'Gợi ý {className}',
  genderLabel: 'Giới tính',
  selectGender: 'Chọn giới tính',
  male: 'Nam',
  female: 'Nữ',
  other: 'Khác',
  saveChanges: 'Lưu',
  saving: 'Đang lưu',
  removing: 'Đang xoá',
  statusModal: { title: 'Trạng thái' },
  deleteModal: { title: 'Xoá học sinh', confirm: 'Xoá' },
  messages: {
    cameraError: 'Camera lỗi',
    cameraRetake: 'Chụp lại',
    cameraUpload: 'Tải ảnh',
    cameraReq: 'Yêu cầu ảnh',
    invalidContact: 'Liên hệ không hợp lệ',
    invalidClass: 'Lớp không hợp lệ',
    successUpdate: 'Đã cập nhật',
    successAdd: 'Đã thêm',
    duplicateId: 'Trùng mã',
    errorSaving: 'Không thể lưu',
  },
};

const TC = { cancel: 'Huỷ' };

const hookArgs = {
  classes: [],
  sortedClasses: [],
  filterableClasses: [],
  teachers: [],
  resolveFaceSrc: () => '',
  onChanged: vi.fn(),
  t: T,
  tc: TC,
};

function Harness() {
  const { controller, modals } = useStudentActionModals(hookArgs);
  return (
    <div>
      <button onClick={() => controller.openCreate()}>create</button>
      {modals}
    </div>
  );
}

const endedClass = {
  id: 'class-ended',
  name: 'Toán 8B',
  startDate: '2026-01-05',
  endDate: '2026-03-31',
  schedule: '',
  daysOfWeek: [],
  description: '',
  startTime: '',
  teacherId: 'teacher-1',
  status: 'active' as const,
  createdAt: '2026-01-05T00:00:00.000Z',
};

const activeClass = {
  id: 'class-active',
  name: 'Toán 8A',
  startDate: '2026-01-05',
  endDate: '2026-12-31',
  schedule: '',
  daysOfWeek: [],
  description: '',
  startTime: '',
  teacherId: 'teacher-1',
  status: 'active' as const,
  createdAt: '2026-01-05T00:00:00.000Z',
};

function GuardHarness() {
  const { controller, modals } = useStudentActionModals({
    ...hookArgs,
    classes: [endedClass, activeClass],
    sortedClasses: [endedClass, activeClass],
    filterableClasses: [endedClass, activeClass],
  });
  return (
    <div>
      <button onClick={() => controller.openCreate({ classId: 'class-ended' })}>
        create-ended
      </button>
      <button onClick={() => controller.openCreate({ classId: 'class-active', fixedClass: true })}>
        create-fixed
      </button>
      <button
        onClick={() =>
          controller.openEdit({
            id: 'stu-1',
            studentId: 'HS260001',
            name: 'HỌC SINH CŨ',
            dob: '2014-01-01',
            contact: '0384072314',
            classId: 'class-ended',
            teacherId: 'teacher-1',
            currentEnrollmentId: 'enrollment-1',
            gender: 'male',
            enrollmentStatus: 'active',
          } as any)
        }
      >
        edit-same-class
      </button>
      <button
        onClick={() =>
          controller.openEdit({
            id: 'stu-1',
            studentId: 'HS260001',
            name: 'HỌC SINH CŨ',
            dob: '2014-01-01',
            contact: '0384072314',
            classId: 'class-ended',
            teacherId: 'teacher-1',
            currentEnrollmentId: 'enrollment-1',
            gender: 'male',
            enrollmentStatus: 'active',
          } as any)
        }
      >
        edit-different-class
      </button>
      {modals}
    </div>
  );
}

describe('useStudentActionModals', () => {
  it('waits for edit reference data before opening the edit modal', async () => {
    const activeClass = {
      id: 'class-1',
      name: 'Movers 2',
      grade: 2,
      status: 'active',
      teacherId: 'teacher-1',
    } as any;
    const loadEditReferences = vi.fn().mockResolvedValue({
      classes: [activeClass],
      sortedClasses: [activeClass],
      filterableClasses: [activeClass],
      teachers: [{ uid: 'teacher-1', displayName: 'Cô Lan' }],
    });
    function LazyEditHarness() {
      const { controller, modals } = useStudentActionModals({
        ...hookArgs,
        loadEditReferences,
      });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              void controller.openEdit({
                id: 'student-1',
                name: 'Nguyễn Minh Anh',
                studentId: 'HS-0248',
                classId: activeClass.id,
                teacherId: 'teacher-1',
                dob: '2014-04-15',
                contact: '0901234567',
                gender: 'female',
              } as any)
            }
          >
            lazy-edit
          </button>
          {modals}
        </>
      );
    }

    render(<LazyEditHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'lazy-edit' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: T.modal.editTitle })).toBeInTheDocument()
    );
    expect(loadEditReferences).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('option', { name: 'Movers 2 - Cô Lan' })).toBeInTheDocument();
    expect(screen.getByDisplayValue(T.gradeOption.replace('{grade}', '2'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: T.saveChanges }));
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/api/v1/students/update',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({ id: 'student-1', classId: activeClass.id, grade: 2 }),
        })
      )
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    localStorage.setItem('language', 'vi');
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('openCreate opens the student form modal', () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('create'));

    expect(screen.getByRole('heading', { name: 'Thêm học sinh' })).toBeInTheDocument();
  });

  it('keeps controller identity stable and reports open modal state', () => {
    const { result, rerender } = renderHook(() => useStudentActionModals(hookArgs));
    const controller = result.current.controller;

    rerender();

    expect(result.current.controller).toBe(controller);

    act(() => controller.openCreate({ classId: 'class-1' }));

    expect(result.current.isAnyOpen).toBe(true);
  });

  it('keeps the full class list for the transfer modal current-class label', () => {
    const archivedClass = {
      ...endedClass,
      id: 'class-archived',
      name: 'Archived source class',
      status: 'archived' as const,
    };
    function TransferHarness() {
      const { controller, modals } = useStudentActionModals({
        ...hookArgs,
        classes: [archivedClass, activeClass],
        sortedClasses: [archivedClass, activeClass],
        filterableClasses: [activeClass],
      });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              controller.openTransfer({
                id: 'student-1',
                studentId: 'HS-0248',
                name: 'Nguyễn Minh Anh',
                classId: archivedClass.id,
              } as any)
            }
          >
            transfer
          </button>
          {modals}
        </>
      );
    }

    render(<TransferHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'transfer' }));

    expect(screen.getByDisplayValue('Archived source class')).toBeInTheDocument();
  });

  it('holds student creation until a join date is confirmed for an ended class', async () => {
    render(<GuardHarness />);
    fireEvent.click(screen.getByText('create-ended'));
    fireEvent.change(screen.getByPlaceholderText('Tên'), { target: { value: 'Học Sinh Mới' } });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'male' } });
    fireEvent.change(screen.getByLabelText('Ngày sinh'), { target: { value: '2014-01-01' } });
    fireEvent.change(screen.getByPlaceholderText('Số điện thoại'), {
      target: { value: '0384072314' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(apiRequestMock).not.toHaveBeenCalled();
    expect(screen.getByText('Lớp đã kết khóa')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Khóa hiện tại/ }));
    fireEvent.change(screen.getByLabelText('Ngày vào học'), {
      target: { value: '2026-02-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/api/v1/students/create',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ classId: 'class-ended', joinedAt: '2026-02-10' }),
        })
      )
    );
  });

  it('does not ask for a join date when editing without changing class', async () => {
    render(<GuardHarness />);
    fireEvent.click(screen.getByText('edit-same-class'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/api/v1/students/update',
        expect.objectContaining({ method: 'PUT' })
      )
    );
    expect(screen.queryByText('Lớp đã kết khóa')).toBeNull();
    const updateBody = apiRequestMock.mock.calls[0]?.[1]?.body;
    expect(updateBody).not.toHaveProperty('joinedAt');
    expect(updateBody).not.toHaveProperty('teacherId');
    expect(updateBody).not.toHaveProperty('currentEnrollmentId');
    expect(updateBody).not.toHaveProperty('enrollmentStatus');
  });

  it('routes a class change during edit through transfer before saving the rest of the profile', async () => {
    // update.ts refuses a classId change outright -- class membership moves
    // through progressStudentToClass now, which the transfer endpoint calls.
    // The edit form has one field for it, so it has to make two requests.
    render(<GuardHarness />);
    fireEvent.click(screen.getByText('edit-different-class'));
    fireEvent.change(screen.getAllByRole('combobox').at(-1) as HTMLSelectElement, {
      target: { value: 'class-active' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/api/v1/students/transfer',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ id: 'stu-1', targetClassId: 'class-active' }),
        })
      )
    );
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/api/v1/students/update',
      expect.objectContaining({ method: 'PUT' })
    );
    const transferCallIndex = apiRequestMock.mock.calls.findIndex(
      ([url]) => url === '/api/v1/students/transfer'
    );
    const updateCallIndex = apiRequestMock.mock.calls.findIndex(
      ([url]) => url === '/api/v1/students/update'
    );
    expect(transferCallIndex).toBeGreaterThanOrEqual(0);
    expect(transferCallIndex).toBeLessThan(updateCallIndex);
  });

  it('shows a fixed current class without a class selector', () => {
    render(<GuardHarness />);
    fireEvent.click(screen.getByText('create-fixed'));

    expect(screen.getByText('Toán 8A')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Lớp/i })).toBeNull();
  });

  it('creates in the fixed class and refreshes the caller', async () => {
    render(<GuardHarness />);
    fireEvent.click(screen.getByText('create-fixed'));
    fireEvent.change(screen.getByPlaceholderText('Tên'), { target: { value: 'Học Sinh Mới' } });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'male' } });
    fireEvent.change(screen.getByLabelText('Ngày sinh'), { target: { value: '2014-01-01' } });
    fireEvent.change(screen.getByPlaceholderText('Số điện thoại'), {
      target: { value: '0384072314' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/api/v1/students/create',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ classId: 'class-active' }),
        })
      )
    );
    expect(hookArgs.onChanged).toHaveBeenCalledTimes(1);
  });
});
