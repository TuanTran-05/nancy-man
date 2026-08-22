// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClassStudentsTab } from './ClassStudentsTab';

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'en', t: translations.en }),
  };
});

describe('ClassStudentsTab lifecycle badges', () => {
  it('uses the scoped course enrollment status instead of a stale profile status', () => {
    render(
      <ClassStudentsTab
        students={[
          {
            id: 'student-on-leave',
            name: 'Student On Leave',
            studentId: 'HS260004',
            classId: 'class-1',
            studentLifecycle: 'enrolled',
            enrollmentStatus: 'active',
            attendanceEnrollment: {
              id: 'enrollment-1',
              classId: 'class-1',
              termStart: '2026-08-13',
              termEnd: '2026-10-06',
              joinedAt: '2026-08-13',
              status: 'on_leave',
            },
          } as any,
        ]}
        searchTerm=""
        setSearchTerm={vi.fn()}
        evaluations={[]}
        onEditEval={vi.fn()}
        onDeleteEval={vi.fn()}
        onOpenEvalSelect={vi.fn()}
        classData={{ id: 'class-1' } as any}
      />
    );

    expect(screen.getByText('On leave')).toBeDefined();
    expect(screen.getByText('Inactive (1)')).toBeDefined();
    expect(screen.queryByText('Active (1)')).toBeNull();
  });

  it('shows trial students in the current roster with a Trial badge', () => {
    render(
      <ClassStudentsTab
        students={[
          {
            id: 'student-1',
            name: 'Trial Student',
            studentId: 'HS260001',
            studentLifecycle: 'trial',
            enrollmentStatus: 'active',
            trialSessionCount: 1,
            trialRequiredSessions: 2,
          } as any,
        ]}
        searchTerm=""
        setSearchTerm={vi.fn()}
        evaluations={[]}
        onEditEval={vi.fn()}
        onDeleteEval={vi.fn()}
        onOpenEvalSelect={vi.fn()}
        classData={{ id: 'class-1' } as any}
      />
    );

    expect(screen.getByText('Trial Student')).toBeDefined();
    expect(screen.getByText('Trial 1/2')).toBeDefined();
  });

  it('renders a card for each row of a duplicated pair', () => {
    // The server decides which physical rows are one child. A roster that
    // collapses them locally hides the duplicate instead of surfacing it.
    render(
      <ClassStudentsTab
        students={[
          {
            id: 'newer-duplicate',
            name: 'Mai Thi Thien Kim',
            studentId: 'HS260321',
            enrollmentStatus: 'active',
            dob: '2014-04-20',
            contact: '0900000000',
          } as any,
          {
            id: 'current-record',
            name: 'Mai Thi Thien Kim',
            studentId: 'HS260316',
            enrollmentStatus: 'active',
            dob: '2014-04-20',
            contact: '0900000000',
          } as any,
        ]}
        searchTerm=""
        setSearchTerm={vi.fn()}
        evaluations={[]}
        onEditEval={vi.fn()}
        onDeleteEval={vi.fn()}
        onOpenEvalSelect={vi.fn()}
        classData={{ id: 'class-1' } as any}
      />
    );

    expect(screen.getAllByText('Mai Thi Thien Kim')).toHaveLength(2);
  });

  it('does not render teacher-side Zalo send actions for final evaluations', () => {
    const { container } = render(
      <ClassStudentsTab
        students={[
          {
            id: 'student-1',
            name: 'Final Student',
            studentId: 'HS260002',
            contact: '0384072314',
            enrollmentStatus: 'active',
          } as any,
        ]}
        searchTerm=""
        setSearchTerm={vi.fn()}
        evaluations={[
          {
            id: 'eval-1',
            studentId: 'student-1',
            classId: 'class-1',
            teacherId: 'teacher-1',
            evaluationType: 'final',
            totalScore: 9,
            finalScore: 9,
            positivePoints: ['Good speaking'],
            improvementPoints: 'Needs more writing',
            date: '2026-05-01',
          } as any,
        ]}
        onEditEval={vi.fn()}
        onDeleteEval={vi.fn()}
        onOpenEvalSelect={vi.fn()}
        onSendZaloEvaluation={vi.fn()}
        classData={{ id: 'class-1' } as any}
      />
    );

    expect(screen.getByText('Final Student')).toBeDefined();
    expect(container.querySelector('button[title="Send results to parent via Zalo"]')).toBeNull();
  });

  it('marks a sent final evaluation locked and removes its edit and delete controls', () => {
    render(
      <ClassStudentsTab
        students={[
          {
            id: 'student-1',
            name: 'Locked Student',
            studentId: 'HS260003',
            enrollmentStatus: 'active',
          } as any,
        ]}
        searchTerm=""
        setSearchTerm={vi.fn()}
        evaluations={[
          {
            id: 'eval-locked',
            studentId: 'student-1',
            classId: 'class-1',
            evaluationType: 'final',
            totalScore: 9,
            date: '2026-07-18',
          } as any,
        ]}
        lockedEvaluationIds={['eval-locked']}
        onEditEval={vi.fn()}
        onDeleteEval={vi.fn()}
        onOpenEvalSelect={vi.fn()}
        classData={{ id: 'class-1' } as any}
      />
    );

    expect(screen.getByText('Sent · locked')).toBeDefined();
    expect(screen.getByTitle(/can no longer be edited or deleted/i)).toBeDefined();
    expect(screen.queryByTitle('Edit Final Evaluation')).toBeNull();
    expect(screen.queryByTitle('Delete Final Evaluation')).toBeNull();
  });
});
