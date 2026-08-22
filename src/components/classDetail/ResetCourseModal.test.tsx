// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResetCourseModal } from './ResetCourseModal';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return { useLanguage: () => ({ language: 'vi', t: translations.vi }) };
});

function snapshot(overrides: Partial<CourseClosingSnapshot> = {}): CourseClosingSnapshot {
  return {
    courseId: 'course-1',
    status: 'completed',
    approvalValid: true,
    requiredStudentCount: 3,
    finalEvaluationCount: 3,
    evaluationSentCount: 3,
    rankRequiredCount: 1,
    rankSentCount: 1,
    tuitionSentCount: 3,
    exemptStudentCount: 0,
    missingEvaluationStudentIds: [],
    pendingEvaluationStudentIds: [],
    pendingRankStudentIds: [],
    pendingTuitionStudentIds: [],
    lockedEvaluationIds: [],
    exemptions: [],
    ...overrides,
  };
}

function renderModal(courseClosing: CourseClosingSnapshot | null, resetError = null as never) {
  render(
    <ResetCourseModal
      isOpen
      onClose={vi.fn()}
      className="Class A"
      daysOfWeek={[2]}
      holidays={[]}
      resetDates={{ startDate: '2026-07-01', endDate: '2026-07-31' }}
      onResetDatesChange={vi.fn()}
      isResettingClass={false}
      onSubmit={vi.fn()}
      courseClosing={courseClosing}
      resetError={resetError}
    />
  );
}

function submitButton() {
  return screen.getByRole('button', { name: /đặt lại|reset/i });
}

describe('ResetCourseModal course closing gate', () => {
  it('enables submit when the course closing snapshot is completed', () => {
    renderModal(snapshot());
    expect(submitButton()).toBeEnabled();
  });

  it('disables submit and lists what is still pending when not completed', () => {
    renderModal(
      snapshot({
        status: 'sending',
        evaluationSentCount: 1,
        rankSentCount: 0,
        tuitionSentCount: 0,
        pendingEvaluationStudentIds: ['student-2', 'student-3'],
        pendingRankStudentIds: ['student-1'],
        pendingTuitionStudentIds: ['student-1', 'student-2', 'student-3'],
      })
    );

    expect(submitButton()).toBeDisabled();
    // Counts for each outstanding channel are visible before submitting.
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getAllByText(/3/).length).toBeGreaterThan(0);
  });

  it('shows the server blocker message returned by a rejected reset', () => {
    renderModal(snapshot({ status: 'sending' }), {
      message: 'Còn 2 học sinh chưa gửi học phí.',
      errorCode: 'COURSE_CLOSING_INCOMPLETE',
    } as never);

    expect(screen.getByText('Còn 2 học sinh chưa gửi học phí.')).toBeInTheDocument();
  });

  it('keeps submit enabled when no snapshot is available yet', () => {
    // Absence of a snapshot must not silently block the legacy flow; the server
    // remains the authority.
    renderModal(null);
    expect(submitButton()).toBeEnabled();
  });
});
