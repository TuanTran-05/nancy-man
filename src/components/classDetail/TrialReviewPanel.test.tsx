// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrialReviewPanel } from './TrialReviewPanel';
import { apiRequest } from '../../lib/api/apiClient';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('TrialReviewPanel', () => {
  it('shows accept and reject actions for trial students ready for review', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });

    render(
      <TrialReviewPanel
        profile={{ uid: 'teacher-1', role: 'teacher' } as any}
        students={[
          {
            id: 'student-1',
            name: 'Trial Student',
            studentId: 'HS260001',
            classId: 'class-1',
            teacherId: 'teacher-1',
            studentLifecycle: 'trial',
            trialReviewStatus: 'pending_teacher_review',
            trialRequiredSessions: 2,
          } as any,
        ]}
        attendance={[]}
        onDecisionComplete={vi.fn()}
      />
    );

    expect(screen.getByText('Trial Student')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Accept/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/admissions/trial-decision', {
        method: 'POST',
        body: { studentId: 'student-1', decision: 'accepted' },
      });
    });
  });

  it('shows loading on the active reject action only', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));

    render(
      <TrialReviewPanel
        profile={{ uid: 'teacher-1', role: 'teacher' } as any}
        students={[
          {
            id: 'student-1',
            name: 'Trial Student',
            studentId: 'HS260001',
            classId: 'class-1',
            teacherId: 'teacher-1',
            studentLifecycle: 'trial',
            trialReviewStatus: 'pending_teacher_review',
            trialRequiredSessions: 2,
          } as any,
        ]}
        attendance={[]}
        onDecisionComplete={vi.fn()}
      />
    );

    const acceptButton = screen.getByRole('button', { name: /Accept/i });
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));

    const rejectButton = await screen.findByRole('button', { name: /Rejecting/i });
    expect(rejectButton).toHaveAttribute('aria-busy', 'true');
    expect(rejectButton).toBeDisabled();
    expect(acceptButton).toHaveAttribute('aria-busy', 'false');
  });
});
