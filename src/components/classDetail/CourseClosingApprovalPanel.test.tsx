// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';
import { CourseClosingApprovalPanel } from './CourseClosingApprovalPanel';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return { useLanguage: () => ({ language: 'en', t: translations.en }) };
});

function snapshot(
  status: CourseClosingSnapshot['status'],
  overrides: Partial<CourseClosingSnapshot> = {}
): CourseClosingSnapshot {
  return {
    courseId: 'course-1',
    status,
    approvalValid: status === 'approved' || status === 'sending' || status === 'completed',
    requiredStudentCount: 2,
    finalEvaluationCount: status === 'missing_evaluations' ? 1 : 2,
    evaluationSentCount: 0,
    rankRequiredCount: 1,
    rankSentCount: 0,
    tuitionSentCount: 0,
    exemptStudentCount: 0,
    missingEvaluationStudentIds: status === 'missing_evaluations' ? ['student-2'] : [],
    pendingEvaluationStudentIds: ['student-1', 'student-2'],
    pendingRankStudentIds: ['student-1'],
    pendingTuitionStudentIds: ['student-1', 'student-2'],
    lockedEvaluationIds: [],
    exemptions: [],
    ...overrides,
  };
}

const classData = {
  id: 'class-1',
  teacherId: 'teacher-1',
  startDate: '2026-05-01',
  endDate: '2026-07-18',
} as any;

describe('CourseClosingApprovalPanel', () => {
  it.each([
    ['no_required_students', 'No required students'],
    ['missing_evaluations', 'Waiting for final evaluations'],
    ['ready_for_approval', 'Ready for approval'],
    ['stale', 'Approval needs renewal'],
    ['approved', 'Approved — ready to send'],
    ['sending', 'Notifications in progress'],
    ['completed', 'Course closing completed'],
  ] as const)('renders the %s state distinctly', (status, label) => {
    render(
      <CourseClosingApprovalPanel
        profile={{ uid: 'office-1', role: 'office' } as any}
        classData={classData}
        snapshot={snapshot(status)}
        loading={false}
        approving={false}
        error={null}
        refresh={vi.fn()}
        approve={vi.fn()}
      />
    );

    expect(screen.getByText(label)).toBeDefined();
    expect(
      screen.getByText(
        status === 'missing_evaluations' ? '1 / 2 final evaluations' : '2 / 2 final evaluations'
      )
    ).toBeDefined();
  });

  it('lets the assigned teacher confirm approval without a reason', async () => {
    const approve = vi.fn().mockResolvedValue(snapshot('approved'));
    render(
      <CourseClosingApprovalPanel
        profile={{ uid: 'teacher-1', role: 'teacher' } as any}
        classData={classData}
        snapshot={snapshot('ready_for_approval')}
        loading={false}
        approving={false}
        error={null}
        refresh={vi.fn()}
        approve={approve}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Confirm Office sending' }));
    expect(screen.getByText(/later roster, date, or evaluation changes/i)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(approve).toHaveBeenCalledWith(undefined);
  });

  it('requires a trimmed reason for Admin approval', async () => {
    const approve = vi.fn().mockResolvedValue(snapshot('approved'));
    render(
      <CourseClosingApprovalPanel
        profile={{ uid: 'admin-1', role: 'admin' } as any}
        classData={classData}
        snapshot={snapshot('stale')}
        loading={false}
        approving={false}
        error={null}
        refresh={vi.fn()}
        approve={approve}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Renew approval' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(screen.getByText('Admin approval reason is required.')).toBeDefined();
    expect(approve).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Approval reason'), '  Reviewed by Admin  ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(approve).toHaveBeenCalledWith('Reviewed by Admin');
  });

  it('keeps Office read-only and allows retry after a load error', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <CourseClosingApprovalPanel
        profile={{ uid: 'office-1', role: 'office' } as any}
        classData={classData}
        snapshot={null}
        loading={false}
        approving={false}
        error={new Error('load failed') as any}
        refresh={refresh}
        approve={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Confirm Office sending' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows loading distinctly and disables approval for a paused class', () => {
    const { rerender } = render(
      <CourseClosingApprovalPanel
        profile={{ uid: 'teacher-1', role: 'teacher' } as any}
        classData={classData}
        snapshot={null}
        loading={true}
        approving={false}
        error={null}
        refresh={vi.fn()}
        approve={vi.fn()}
      />
    );
    expect(screen.getByText('Loading course-closing status…')).toBeDefined();

    rerender(
      <CourseClosingApprovalPanel
        profile={{ uid: 'teacher-1', role: 'teacher' } as any}
        classData={{ ...classData, status: 'paused' }}
        snapshot={snapshot('ready_for_approval')}
        loading={false}
        approving={false}
        error={null}
        refresh={vi.fn()}
        approve={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Confirm Office sending' })).toBeDisabled();
  });
});
