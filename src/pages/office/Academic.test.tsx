// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Academic from './Academic';
import { readChannel } from '../../lib/api/readApi';
import {
  sendZaloEvaluationNotification,
  sendZaloTuitionNoticeNotification,
  sendZaloRankNotification,
} from '../../lib/zalo/zaloService';
import { createZaloBulkNotificationJob } from '../../hooks/useZaloNotifications';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../../lib/zalo/zaloService', () => ({
  sendZaloEvaluationNotification: vi.fn().mockResolvedValue({ success: true, messageId: 'eval-1' }),
  sendZaloTuitionNoticeNotification: vi
    .fn()
    .mockResolvedValue({ success: true, messageId: 'tuition-1' }),
  sendZaloRankNotification: vi.fn().mockResolvedValue({ success: true, messageId: 'rank-1' }),
}));

vi.mock('../../hooks/useZaloNotifications', () => ({
  createZaloBulkNotificationJob: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return { useLanguage: () => ({ language: 'vi', t: translations.vi }) };
});

let mockAuth: { profile: { uid: string; role: string } | null } = {
  profile: { uid: 'office-1', role: 'office' },
};

function renderAcademic(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Academic />
    </QueryClientProvider>
  );
  return { ...view, queryClient };
}

function courseClosing(overrides: Partial<CourseClosingSnapshot> = {}): CourseClosingSnapshot {
  return {
    courseId: 'course-1',
    status: 'sending',
    approvalValid: true,
    requiredStudentCount: 2,
    finalEvaluationCount: 2,
    evaluationSentCount: 1,
    rankRequiredCount: 1,
    rankSentCount: 0,
    tuitionSentCount: 0,
    exemptStudentCount: 0,
    missingEvaluationStudentIds: [],
    pendingEvaluationStudentIds: ['student-2'],
    pendingRankStudentIds: ['student-2'],
    pendingTuitionStudentIds: ['student-1', 'student-2'],
    lockedEvaluationIds: [],
    exemptions: [],
    ...overrides,
  };
}

function payloadWithCourseClosing(overrides: Partial<CourseClosingSnapshot>) {
  return {
    ...academicPayload,
    summaries: {
      'class-1': {
        ...academicPayload.summaries['class-1'],
        courseClosing: courseClosing(overrides),
      },
    },
  };
}

function openStudentsTable() {
  const studentsTab = screen
    .getAllByRole('button')
    .find((button) => button.textContent?.includes('Danh') && button.textContent.includes('sinh'));
  expect(studentsTab).toBeDefined();
  fireEvent.click(studentsTab!);
  fireEvent.click(screen.getByTitle('Xem dạng bảng'));
}

const academicPayload = {
  classes: [
    {
      id: 'class-1',
      name: 'Class A',
      teacherId: 'teacher-1',
      status: 'active',
      endDate: '2026-05-31',
      tuitionFee: 1000000,
    },
  ],
  students: [
    {
      id: 'student-1',
      name: 'Student One',
      studentId: 'HS001',
      classId: 'class-1',
      contact: '0384072314',
      enrollmentStatus: 'active',
    },
    {
      id: 'student-2',
      name: 'Student Two',
      studentId: 'HS002',
      classId: 'class-1',
      contact: '0384072315',
      enrollmentStatus: 'on_leave',
    },
  ],
  evaluations: [
    {
      id: 'eval-1',
      studentId: 'student-1',
      classId: 'class-1',
      evaluationType: 'final',
      finalScore: 9,
      totalScore: 9,
      positivePoints: ['Confident speaking'],
      improvementPoints: 'Needs more writing',
      date: '2026-05-01',
      createdAt: '2026-05-01T00:00:00.000Z',
    },
    {
      id: 'eval-2',
      studentId: 'student-2',
      classId: 'class-1',
      evaluationType: 'final',
      finalScore: 8,
      totalScore: 8,
      positivePoints: ['Good listening'],
      improvementPoints: 'Needs more vocabulary',
      rank: 'first',
      date: '2026-05-02',
      createdAt: '2026-05-02T00:00:00.000Z',
    },
  ],
  ledgers: [],
  notifications: [],
  summaries: {
    'class-1': {
      classId: 'class-1',
      eligibleStudentCount: 2,
      finalEvaluationCount: 2,
      isEvaluationComplete: true,
      evaluationSentCount: 1,
      tuitionNoticeSentCount: 0,
      missingEvaluationStudentIds: [],
      failedNotificationCount: 0,
      evaluationSentStudentIds: ['student-1'],
      tuitionNoticeSentStudentIds: [],
      rankSentStudentIds: [],
      courseClosing: {
        courseId: 'course-1',
        status: 'sending',
        approvalValid: true,
        requiredStudentCount: 2,
        finalEvaluationCount: 2,
        evaluationSentCount: 1,
        rankRequiredCount: 1,
        rankSentCount: 0,
        tuitionSentCount: 0,
        exemptStudentCount: 0,
        missingEvaluationStudentIds: [],
        pendingEvaluationStudentIds: ['student-2'],
        pendingRankStudentIds: ['student-2'],
        pendingTuitionStudentIds: ['student-1', 'student-2'],
        lockedEvaluationIds: [],
        exemptions: [],
      },
    },
  },
};

describe('Academic office page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readChannel).mockReset();
    mockAuth = { profile: { uid: 'office-1', role: 'office' } };
    vi.mocked(readChannel).mockResolvedValue(academicPayload as any);
    vi.mocked(sendZaloEvaluationNotification).mockResolvedValue({
      success: true,
      messageId: 'eval-msg',
    });
    vi.mocked(sendZaloTuitionNoticeNotification).mockResolvedValue({
      success: true,
      messageId: 'tuition-msg',
    });
    vi.mocked(sendZaloRankNotification).mockResolvedValue({
      success: true,
      messageId: 'rank-msg',
    });
    vi.mocked(createZaloBulkNotificationJob).mockImplementation(async (input: any) => {
      const items =
        input.items ||
        input.studentIds?.map((studentId: string) => ({
          studentId,
          payload: input.payload || {},
        })) ||
        [];
      return {
        success: true,
        jobId: `${input.type}-job`,
        requestedCount: items.length,
        processedCount: items.length,
        successCount: items.length,
        failureCount: 0,
        results: items.map((item: any) => ({
          studentId: item.studentId,
          success: true,
          messageId: `${input.type}-${item.studentId}`,
        })),
      };
    });
  });

  it('shows class completion status and office bulk action buttons', async () => {
    renderAcademic();

    expect(await screen.findByText('Học vụ')).toBeDefined();
    expect(screen.getAllByText('Class A')[0]).toBeDefined();
    expect(screen.getByText('Cần gửi')).toBeDefined();
    expect(screen.getAllByText((_, node) => node?.textContent === '2/2 nhận xét')[0]).toBeDefined();
    expect(screen.getByRole('button', { name: /^Gửi nhận xét hàng loạt$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Gửi học phí hàng loạt$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Gửi cả nhận xét & học phí$/i })).toBeDefined();

    // Switch to Students Tab to verify student details rendering
    const studentsTab = screen.getByRole('button', { name: /Danh sách học sinh/i });
    fireEvent.click(studentsTab);

    expect(screen.getAllByText('Student One')[0]).toBeDefined();
    expect(screen.getByText(/Confident speaking/i)).toBeDefined();
  });

  it('exposes the class selector as a persistent navigation landmark', async () => {
    renderAcademic();

    const classSelector = await screen.findByRole('navigation', { name: /chọn khóa học/i });
    const selectedClassButton = screen.getByRole('button', { name: /Class A/i });

    expect(classSelector).toBeDefined();
    expect(selectedClassButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides paused classes from the office academic work queue', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      classes: [
        {
          id: 'class-paused',
          name: 'Paused Class',
          teacherId: 'teacher-1',
          status: 'paused',
          endDate: '2026-06-30',
          tuitionFee: 1000000,
        },
        {
          ...academicPayload.classes[0],
          name: 'Active Class',
        },
      ],
      students: [
        {
          ...academicPayload.students[0],
          classId: 'class-1',
        },
        {
          id: 'paused-student',
          name: 'Paused Student',
          studentId: 'HS009',
          classId: 'class-paused',
          contact: '0384072399',
          enrollmentStatus: 'active',
        },
      ],
      evaluations: [
        {
          ...academicPayload.evaluations[0],
          studentId: 'student-1',
          classId: 'class-1',
        },
        {
          id: 'eval-paused',
          studentId: 'paused-student',
          classId: 'class-paused',
          evaluationType: 'final',
          finalScore: 8,
          totalScore: 8,
          positivePoints: ['Good effort'],
          improvementPoints: 'Keep practicing',
          date: '2026-05-02',
          createdAt: '2026-05-02T00:00:00.000Z',
        },
      ],
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          eligibleStudentCount: 1,
          finalEvaluationCount: 1,
          isEvaluationComplete: true,
          evaluationSentCount: 0,
          tuitionNoticeSentCount: 0,
          evaluationSentStudentIds: [],
          tuitionNoticeSentStudentIds: [],
          rankSentStudentIds: [],
        },
        'class-paused': {
          classId: 'class-paused',
          eligibleStudentCount: 1,
          finalEvaluationCount: 1,
          isEvaluationComplete: true,
          evaluationSentCount: 0,
          tuitionNoticeSentCount: 0,
          missingEvaluationStudentIds: [],
          failedNotificationCount: 0,
          evaluationSentStudentIds: [],
          tuitionNoticeSentStudentIds: [],
          rankSentStudentIds: [],
        },
      },
    } as any);

    renderAcademic();

    expect(await screen.findAllByText('Active Class')).not.toHaveLength(0);
    expect(screen.queryByText('Paused Class')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Gửi nhận xét hàng loạt$/i }));

    await waitFor(() => {
      expect(createZaloBulkNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class-1',
          type: 'evaluation',
          items: [expect.objectContaining({ studentId: 'student-1' })],
        })
      );
    });
    expect(createZaloBulkNotificationJob).not.toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'class-paused',
      })
    );
  });

  it('sends only missing evaluation notifications through one bulk API request', async () => {
    renderAcademic();

    await screen.findAllByText('Class A');
    fireEvent.click(screen.getByRole('button', { name: /^Gửi nhận xét hàng loạt$/i }));

    await waitFor(() => {
      expect(createZaloBulkNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class-1',
          type: 'evaluation',
          // Task 8 narrowed bulk items to identifiers only; academic content is
          // rebuilt server-side from canonical DocumentStore data.
          items: [{ studentId: 'student-2' }],
        })
      );
    });
    expect(createZaloBulkNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'class-1',
        type: 'rank_achievement',
      })
    );
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
    openStudentsTable();
    expect((await screen.findAllByText('Student One'))[0]).toBeDefined();
    expect(await screen.findByText('Bỏ qua')).toBeDefined();
    expect(await screen.findByText('Đã gửi')).toBeDefined();
  });

  it('keeps on-leave students without comments visible but blocks evaluation sends for them', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      evaluations: [academicPayload.evaluations[0]],
      summaries: {
        'class-1': {
          classId: 'class-1',
          eligibleStudentCount: 1,
          finalEvaluationCount: 1,
          isEvaluationComplete: true,
          evaluationSentCount: 0,
          tuitionNoticeSentCount: 0,
          missingEvaluationStudentIds: [],
          failedNotificationCount: 0,
          evaluationSentStudentIds: [],
          tuitionNoticeSentStudentIds: [],
          rankSentStudentIds: [],
          courseClosing: courseClosing({
            requiredStudentCount: 1,
            finalEvaluationCount: 1,
            evaluationSentCount: 0,
            rankRequiredCount: 0,
            pendingEvaluationStudentIds: ['student-1'],
            pendingRankStudentIds: [],
            pendingTuitionStudentIds: ['student-1'],
          }),
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    fireEvent.click(screen.getByRole('button', { name: /^Gửi nhận xét hàng loạt$/i }));

    await waitFor(() => {
      expect(createZaloBulkNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'evaluation',
          items: [expect.objectContaining({ studentId: 'student-1' })],
        })
      );
    });
    expect(createZaloBulkNotificationJob).not.toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ studentId: 'student-2' })]),
      })
    );
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
    expect(await screen.findByText('Bỏ qua')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Danh sách học sinh/i }));

    const pausedEvaluationButton = screen.getByTestId('academic-student-student-2-send-evaluation');
    expect(pausedEvaluationButton).toBeDisabled();
    expect(pausedEvaluationButton).toHaveAttribute(
      'title',
      'Học sinh tạm nghỉ và giáo viên chưa nhập nhận xét.'
    );
    expect(
      screen.getAllByText('Học sinh tạm nghỉ và giáo viên chưa nhập nhận xét.').length
    ).toBeGreaterThan(0);
  });

  it('skips tuition in both mode for on-leave students without final evaluation', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      evaluations: [academicPayload.evaluations[0]],
      summaries: {
        'class-1': {
          classId: 'class-1',
          eligibleStudentCount: 1,
          finalEvaluationCount: 1,
          isEvaluationComplete: true,
          evaluationSentCount: 0,
          tuitionNoticeSentCount: 0,
          missingEvaluationStudentIds: [],
          failedNotificationCount: 0,
          evaluationSentStudentIds: [],
          tuitionNoticeSentStudentIds: [],
          rankSentStudentIds: [],
          courseClosing: courseClosing({
            requiredStudentCount: 1,
            finalEvaluationCount: 1,
            evaluationSentCount: 0,
            rankRequiredCount: 0,
            pendingEvaluationStudentIds: ['student-1'],
            pendingRankStudentIds: [],
            pendingTuitionStudentIds: ['student-1'],
          }),
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    const bothButton = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('&') && button.textContent.includes('ph'));
    expect(bothButton).toBeDefined();
    fireEvent.click(bothButton!);

    await waitFor(() => {
      expect(createZaloBulkNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'evaluation',
          items: [expect.objectContaining({ studentId: 'student-1' })],
        })
      );
      expect(createZaloBulkNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tuition_notice',
          items: [expect.objectContaining({ studentId: 'student-1' })],
        })
      );
    });
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
    expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalled();
  });

  it('skips tuition-only sends for on-leave students without final evaluation', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      evaluations: [academicPayload.evaluations[0]],
      summaries: {
        'class-1': {
          classId: 'class-1',
          eligibleStudentCount: 1,
          finalEvaluationCount: 1,
          isEvaluationComplete: true,
          evaluationSentCount: 1,
          tuitionNoticeSentCount: 0,
          missingEvaluationStudentIds: [],
          failedNotificationCount: 0,
          evaluationSentStudentIds: ['student-1'],
          tuitionNoticeSentStudentIds: [],
          rankSentStudentIds: [],
          courseClosing: courseClosing({
            requiredStudentCount: 1,
            finalEvaluationCount: 1,
            evaluationSentCount: 1,
            rankRequiredCount: 0,
            pendingEvaluationStudentIds: [],
            pendingRankStudentIds: [],
            pendingTuitionStudentIds: ['student-1'],
          }),
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    const tuitionButton = screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.getAttribute('aria-label')?.includes('ph') &&
          button.getAttribute('aria-label')?.includes('lo')
      );
    expect(tuitionButton).toBeDefined();
    fireEvent.click(tuitionButton!);

    await waitFor(() => {
      expect(createZaloBulkNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tuition_notice',
          items: [expect.objectContaining({ studentId: 'student-1' })],
        })
      );
    });
    expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalled();
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
  });

  it('does not send tuition-only before the evaluation notice was sent', async () => {
    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    const tuitionButton = screen.getByTestId('academic-student-student-2-send-tuition');

    expect(tuitionButton).toBeDisabled();
    fireEvent.click(tuitionButton);
    expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalled();
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
  });

  it('shows loading state only on the active bulk action button', async () => {
    let resolveEvaluation: ((value: any) => void) | undefined;
    const evaluationPromise = new Promise<any>((resolve) => {
      resolveEvaluation = resolve;
    });
    vi.mocked(createZaloBulkNotificationJob).mockReturnValue(evaluationPromise);

    renderAcademic();

    await screen.findAllByText('Class A');
    const evaluationButton = screen.getByRole('button', { name: /^Gửi nhận xét hàng loạt$/i });
    const tuitionButton = screen.getByRole('button', { name: /^Gửi học phí hàng loạt$/i });

    fireEvent.click(evaluationButton);

    await waitFor(() => {
      expect(evaluationButton.getAttribute('aria-busy')).toBe('true');
    });
    expect(tuitionButton.getAttribute('aria-busy')).not.toBe('true');

    resolveEvaluation?.({
      success: true,
      jobId: 'evaluation-job',
      requestedCount: 1,
      successCount: 1,
      failureCount: 0,
      results: [{ studentId: 'student-2', success: true, messageId: 'eval-msg' }],
    });

    await waitFor(() => {
      expect(evaluationButton.getAttribute('aria-busy')).toBe('false');
    });
  });

  it('sends notification actions for a single student row', async () => {
    renderAcademic();

    await screen.findAllByText('Class A');

    // Switch to Students Tab
    const studentsTab = screen.getByRole('button', { name: /Danh sách học sinh/i });
    fireEvent.click(studentsTab);

    // Switch to Table View to expose individual action buttons
    const tableViewButton = screen.getByTitle('Xem dạng bảng');
    fireEvent.click(tableViewButton);

    expect(screen.getByTestId('academic-student-student-2-send-evaluation')).toBeDefined();
    expect(screen.getByTestId('academic-student-student-2-send-tuition')).toBeDefined();

    fireEvent.click(screen.getByTestId('academic-student-student-2-send-both'));

    await waitFor(() => {
      expect(sendZaloEvaluationNotification).toHaveBeenCalledTimes(1);
      expect(sendZaloTuitionNoticeNotification).toHaveBeenCalledTimes(1);
    });
    expect(sendZaloEvaluationNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-2',
        classId: 'class-1',
      })
    );
    // Task 7 narrowed single sends to identifiers; the amount is resolved from
    // the verified ledger on the server.
    expect(sendZaloTuitionNoticeNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-2',
        classId: 'class-1',
      })
    );
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'student-1' })
    );
    expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'student-1' })
    );
    expect(screen.getAllByText('Student Two').length).toBeGreaterThan(1);
    expect(screen.getAllByText(/đã gửi/i).length).toBeGreaterThanOrEqual(2);
  });

  it('sends evaluation, rank, and tuition in order for ranked students in both mode', async () => {
    renderAcademic();

    await screen.findAllByText('Class A');
    fireEvent.click(screen.getByRole('button', { name: /Danh sách học sinh/i }));
    fireEvent.click(screen.getByTitle('Xem dạng bảng'));
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-both'));

    await waitFor(() => {
      expect(sendZaloEvaluationNotification).toHaveBeenCalledTimes(1);
      expect(sendZaloRankNotification).toHaveBeenCalledTimes(1);
      expect(sendZaloTuitionNoticeNotification).toHaveBeenCalledTimes(1);
    });

    expect(sendZaloRankNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-2',
        classId: 'class-1',
      })
    );

    const evalOrder = vi.mocked(sendZaloEvaluationNotification).mock.invocationCallOrder[0];
    const rankOrder = vi.mocked(sendZaloRankNotification).mock.invocationCallOrder[0];
    const tuitionOrder = vi.mocked(sendZaloTuitionNoticeNotification).mock.invocationCallOrder[0];
    expect(evalOrder).toBeLessThan(rankOrder);
    expect(rankOrder).toBeLessThan(tuitionOrder);
  });

  it('continues to tuition when Office Academic rank notification fails', async () => {
    vi.mocked(sendZaloRankNotification).mockResolvedValueOnce({
      success: false,
      error: 'Rank template failed',
    });

    renderAcademic();

    await screen.findAllByText('Class A');
    fireEvent.click(screen.getByRole('button', { name: /Danh sách học sinh/i }));
    fireEvent.click(screen.getByTitle('Xem dạng bảng'));
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-both'));

    await waitFor(() => {
      expect(sendZaloEvaluationNotification).toHaveBeenCalledTimes(1);
      expect(sendZaloRankNotification).toHaveBeenCalledTimes(1);
      expect(sendZaloTuitionNoticeNotification).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/Rank template failed/i)).toBeDefined();
  });

  it('does not send rank or tuition in both mode when evaluation notification fails', async () => {
    vi.mocked(sendZaloEvaluationNotification).mockResolvedValueOnce({
      success: false,
      error: 'Evaluation template failed',
    });

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-both'));

    await waitFor(() => {
      expect(sendZaloEvaluationNotification).toHaveBeenCalledTimes(1);
    });

    expect(sendZaloRankNotification).not.toHaveBeenCalled();
    expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalled();
    expect(await screen.findByText(/Evaluation template failed/i)).toBeDefined();
  });

  it('enables manual rank sends only for students with a saved rank', async () => {
    renderAcademic();

    await screen.findAllByText('Class A');
    fireEvent.click(screen.getByRole('button', { name: /Danh sách học sinh/i }));
    fireEvent.click(screen.getByTitle('Xem dạng bảng'));

    const unrankedRankButton = screen.getByTestId('academic-student-student-1-send-rank');
    const rankedRankButton = screen.getByTestId('academic-student-student-2-send-rank');

    expect(unrankedRankButton).toBeDisabled();
    expect(rankedRankButton).not.toBeDisabled();

    fireEvent.click(rankedRankButton);

    await waitFor(() => {
      expect(sendZaloRankNotification).toHaveBeenCalledTimes(1);
    });
    expect(sendZaloRankNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-2',
        classId: 'class-1',
      })
    );
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
    expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalled();
  });

  it('skips rank notification in both mode when rank was already sent', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          rankSentStudentIds: ['student-2'],
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-both'));

    await waitFor(() => {
      expect(sendZaloEvaluationNotification).toHaveBeenCalledTimes(1);
      expect(sendZaloTuitionNoticeNotification).toHaveBeenCalledTimes(1);
    });
    expect(sendZaloRankNotification).not.toHaveBeenCalled();
  });

  it('skips manual rank notification when rank was already sent', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          rankSentStudentIds: ['student-2'],
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-rank'));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          (_, node) => node?.tagName === 'SPAN' && Boolean(node.textContent?.includes('qua h'))
        ).length
      ).toBeGreaterThan(0);
    });
    expect(sendZaloRankNotification).not.toHaveBeenCalled();
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
    expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalled();
  });

  it('treats uppercase ON_LEAVE students without final evaluation as on-leave', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      students: [
        academicPayload.students[0],
        {
          ...academicPayload.students[1],
          enrollmentStatus: 'ON_LEAVE',
        },
      ],
      evaluations: academicPayload.evaluations.filter(
        (evaluation) => evaluation.studentId !== 'student-2'
      ),
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          eligibleStudentCount: 1,
          finalEvaluationCount: 1,
          isEvaluationComplete: true,
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-both'));

    await waitFor(() => {
      expect(sendZaloEvaluationNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({ studentId: 'student-2' })
      );
      expect(sendZaloTuitionNoticeNotification).not.toHaveBeenCalled();
    });
  });

  it('sorts and prioritizes ISO datetime end dates as course dates', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      classes: [
        {
          ...academicPayload.classes[0],
          endDate: '2026-05-31T00:00:00Z',
        },
      ],
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          eligibleStudentCount: 2,
          finalEvaluationCount: 1,
          isEvaluationComplete: false,
          evaluationSentCount: 0,
          evaluationSentStudentIds: [],
        },
      },
    } as any);

    renderAcademic();

    expect(await screen.findByText('Cần nhận xét')).toBeDefined();
  });

  it('sends rank in both mode when evaluation was already sent but rank was not', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          evaluationSentCount: 2,
          evaluationSentStudentIds: ['student-1', 'student-2'],
          rankSentStudentIds: [],
          tuitionNoticeSentStudentIds: [],
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-both'));

    await waitFor(() => {
      expect(sendZaloRankNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'student-2',
        })
      );
      expect(sendZaloTuitionNoticeNotification).toHaveBeenCalledTimes(1);
    });
    expect(sendZaloEvaluationNotification).not.toHaveBeenCalled();
  });

  it('excludes ranked students from completed tab until rank notification is sent', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          evaluationSentCount: 2,
          evaluationSentStudentIds: ['student-1', 'student-2'],
          tuitionNoticeSentCount: 2,
          tuitionNoticeSentStudentIds: ['student-1', 'student-2'],
          rankSentStudentIds: [],
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    const completedTab = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('hoàn thành'));
    expect(completedTab).toBeDefined();
    fireEvent.click(completedTab!);

    expect(screen.queryByText('Student Two')).not.toBeInTheDocument();
    expect(screen.getByText('Student One')).toBeInTheDocument();
  });

  it('disables refresh while a batch action is running', async () => {
    let resolveEvaluation: (value: { success: true; messageId: string }) => void = () => {};
    vi.mocked(sendZaloEvaluationNotification).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEvaluation = resolve;
        })
    );

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    fireEvent.click(screen.getByTestId('academic-student-student-2-send-evaluation'));

    expect(screen.getAllByRole('button', { name: /Làm mới/i })[0]).toBeDisabled();

    resolveEvaluation({ success: true, messageId: 'eval-msg' });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Làm mới/i })[0]).not.toBeDisabled();
    });
  });

  it('clears the student status filter when switching to completed tab', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ...academicPayload,
      summaries: {
        'class-1': {
          ...academicPayload.summaries['class-1'],
          evaluationSentStudentIds: ['student-1'],
          tuitionNoticeSentStudentIds: ['student-1'],
        },
      },
    } as any);

    renderAcademic();

    await screen.findAllByText('Class A');
    openStudentsTable();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'unsent_eval' } });

    const completedTab = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('hoàn thành'));
    expect(completedTab).toBeDefined();
    fireEvent.click(completedTab!);

    expect(screen.getByRole('combobox')).toHaveValue('all');
  });

  it('reuses the cached academic payload after a route remount', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderAcademic(queryClient);
    expect(await screen.findAllByText('Class A')).not.toHaveLength(0);
    first.unmount();

    renderAcademic(queryClient);
    expect(await screen.findAllByText('Class A')).not.toHaveLength(0);

    expect(readChannel).toHaveBeenCalledTimes(1);
  });

  it('keeps cached academic data visible and offers retry after background failure', async () => {
    const { queryClient } = renderAcademic();
    expect(await screen.findAllByText('Class A')).not.toHaveLength(0);
    vi.mocked(readChannel).mockRejectedValueOnce(new Error('background network failure'));

    await act(async () => {
      await queryClient.invalidateQueries();
    });

    expect(screen.getAllByText('Class A')).not.toHaveLength(0);
    expect(
      await screen.findByText('Không thể cập nhật dữ liệu mới. Đang hiển thị bản đã lưu.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => {
      expect(readChannel).toHaveBeenCalledTimes(3);
      expect(
        screen.queryByText('Không thể cập nhật dữ liệu mới. Đang hiển thị bản đã lưu.')
      ).not.toBeInTheDocument();
    });
  });

  it('does not start a second request when refresh is clicked twice', async () => {
    let resolveRefresh: ((value: unknown) => void) | undefined;
    renderAcademic();
    expect(await screen.findAllByText('Class A')).not.toHaveLength(0);
    vi.mocked(readChannel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }) as any
    );

    const refresh = screen.getAllByRole('button', { name: /^Làm mới$/i })[0];
    fireEvent.click(refresh);
    fireEvent.click(refresh);

    await waitFor(() => expect(readChannel).toHaveBeenCalledTimes(2));
    expect(refresh).toBeDisabled();

    await act(async () => {
      resolveRefresh?.(academicPayload);
    });
  });

  describe('course closing gate', () => {
    const batchButtons = {
      evaluation: /^Gửi nhận xét hàng loạt$/i,
      tuition: /^Gửi học phí hàng loạt$/i,
      both: /^Gửi cả nhận xét & học phí$/i,
    } as const;

    it.each([
      ['missing_evaluations', 'Đang chờ đủ nhận xét cuối khóa'],
      ['ready_for_approval', 'Sẵn sàng xác nhận'],
      ['stale', 'Cần xác nhận lại'],
      ['approved', 'Đã xác nhận — sẵn sàng gửi'],
      ['sending', 'Đang gửi thông báo'],
      ['completed', 'Đã hoàn tất chốt khóa'],
      ['no_required_students', 'Không có học viên bắt buộc'],
    ] as const)('labels the %s status', async (status, label) => {
      vi.mocked(readChannel).mockResolvedValue(
        payloadWithCourseClosing({
          status,
          approvalValid: status === 'approved' || status === 'sending' || status === 'completed',
        }) as any
      );

      renderAcademic();

      expect(await screen.findAllByText(label)).not.toHaveLength(0);
    });

    it.each(['evaluation', 'tuition', 'both'] as const)(
      'blocks the %s batch when teacher approval is invalid',
      async (mode) => {
        vi.mocked(readChannel).mockResolvedValue(
          payloadWithCourseClosing({ status: 'ready_for_approval', approvalValid: false }) as any
        );

        renderAcademic();
        await screen.findAllByText('Class A');

        const button = screen.getByRole('button', { name: batchButtons[mode] });
        expect(button).toBeDisabled();

        fireEvent.click(button);
        await waitFor(() => expect(createZaloBulkNotificationJob).not.toHaveBeenCalled());
      }
    );

    it('blocks rank sending even when a ranked final evaluation exists', async () => {
      vi.mocked(readChannel).mockResolvedValue(
        payloadWithCourseClosing({
          status: 'stale',
          approvalValid: false,
          staleReason: 'COURSE_DATES_CHANGED',
        }) as any
      );

      renderAcademic();
      await screen.findAllByText('Class A');
      openStudentsTable();

      const rankButtons = screen.getAllByRole('button', { name: /hạng/i });
      for (const button of rankButtons) expect(button).toBeDisabled();
      expect(createZaloBulkNotificationJob).not.toHaveBeenCalled();
    });

    it('enables only pending and dependency-valid student actions when approved', async () => {
      vi.mocked(readChannel).mockResolvedValue(
        payloadWithCourseClosing({
          status: 'sending',
          approvalValid: true,
          pendingEvaluationStudentIds: ['student-2'],
          pendingTuitionStudentIds: ['student-1', 'student-2'],
          pendingRankStudentIds: [],
        }) as any
      );

      renderAcademic();
      await screen.findAllByText('Class A');

      // student-1 already has evaluation evidence, so tuition is unlocked for them.
      // student-2 still needs its evaluation, so its tuition stays blocked.
      const tuitionButton = screen.getByRole('button', { name: batchButtons.tuition });
      expect(tuitionButton).toBeEnabled();
    });

    it('shows the exemption reason and no send action for an exempt student', async () => {
      vi.mocked(readChannel).mockResolvedValue(
        payloadWithCourseClosing({
          exemptStudentCount: 1,
          pendingEvaluationStudentIds: [],
          pendingRankStudentIds: [],
          pendingTuitionStudentIds: ['student-1'],
          exemptions: [
            {
              studentId: 'student-2',
              reason: 'Không còn kênh liên hệ',
              createdBy: 'admin-1',
              createdAt: '2026-07-18T00:00:00.000Z',
            },
          ],
        }) as any
      );

      renderAcademic();
      await screen.findAllByText('Class A');
      openStudentsTable();

      expect(screen.getAllByText(/Không còn kênh liên hệ/)[0]).toBeInTheDocument();
    });

    it('offers the exemption action to Admin only', async () => {
      mockAuth = { profile: { uid: 'admin-1', role: 'admin' } };
      renderAcademic();
      await screen.findAllByText('Class A');
      openStudentsTable();

      expect(screen.getAllByRole('button', { name: /^Miễn gửi$/i })[0]).toBeInTheDocument();
    });

    it('never offers the exemption action to Office', async () => {
      mockAuth = { profile: { uid: 'office-1', role: 'office' } };
      renderAcademic();
      await screen.findAllByText('Class A');
      openStudentsTable();

      expect(screen.queryByRole('button', { name: /^Miễn gửi$/i })).not.toBeInTheDocument();
    });
  });
});
