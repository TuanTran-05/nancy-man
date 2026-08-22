// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseClosingExemptionModal } from './CourseClosingExemptionModal';
import { ApiError, apiRequest } from '../../lib/api/apiClient';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return { useLanguage: () => ({ language: 'vi', t: translations.vi }) };
});

vi.mock('../../lib/api/apiClient', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/apiClient')>('../../lib/api/apiClient');
  return { ...actual, apiRequest: vi.fn() };
});

const snapshot: CourseClosingSnapshot = {
  courseId: 'course-1',
  status: 'sending',
  approvalValid: true,
  requiredStudentCount: 2,
  finalEvaluationCount: 2,
  evaluationSentCount: 1,
  rankRequiredCount: 0,
  rankSentCount: 0,
  tuitionSentCount: 0,
  exemptStudentCount: 1,
  missingEvaluationStudentIds: [],
  pendingEvaluationStudentIds: [],
  pendingRankStudentIds: [],
  pendingTuitionStudentIds: [],
  lockedEvaluationIds: [],
  exemptions: [
    { studentId: 'student-2', reason: 'Không liên hệ được', createdBy: 'admin-1', createdAt: '' },
  ],
};

function renderModal(overrides: Record<string, unknown> = {}) {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(
    <CourseClosingExemptionModal
      classId="class-1"
      studentId="student-2"
      studentName="Student Two"
      onClose={onClose}
      onSuccess={onSuccess}
      {...overrides}
    />
  );
  return { onSuccess, onClose };
}

describe('CourseClosingExemptionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({ success: true, courseClosing: snapshot } as never);
  });

  it('rejects a whitespace-only reason without calling the API', async () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/lý do miễn gửi/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /^miễn gửi$/i }));

    expect(await screen.findByText(/phải nhập lý do/i)).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('submits class, student and trimmed reason then reports the new snapshot', async () => {
    const { onSuccess } = renderModal();

    fireEvent.change(screen.getByLabelText(/lý do miễn gửi/i), {
      target: { value: '  Không còn kênh liên hệ  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^miễn gửi$/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/exempt-course-closing-student', {
      method: 'POST',
      body: {
        classId: 'class-1',
        studentId: 'student-2',
        reason: 'Không còn kênh liên hệ',
      },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(snapshot));
  });

  it('keeps the reason and shows the server message when the API fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError('Lớp chưa được giáo viên xác nhận', 409, {
        errorCode: 'COURSE_CLOSING_NOT_APPROVED',
      })
    );
    const { onSuccess, onClose } = renderModal();

    const textarea = screen.getByLabelText(/lý do miễn gửi/i);
    fireEvent.change(textarea, { target: { value: 'Không liên hệ được' } });
    fireEvent.click(screen.getByRole('button', { name: /^miễn gửi$/i }));

    expect(await screen.findByText('Lớp chưa được giáo viên xác nhận')).toBeInTheDocument();
    expect(textarea).toHaveValue('Không liên hệ được');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
