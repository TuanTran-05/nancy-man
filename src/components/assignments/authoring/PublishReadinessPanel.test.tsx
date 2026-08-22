// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import { PublishReadinessPanel } from './PublishReadinessPanel';

describe('PublishReadinessPanel', () => {
  it('shows blocker count and lets the user jump to a question issue', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    const issueSelect = vi.fn();

    render(
      <PublishReadinessPanel
        draft={draft}
        isPublishing={false}
        onIssueSelect={issueSelect}
        onPublish={vi.fn()}
      />
    );

    expect(screen.getByText(/Fix [0-9]+ issue/)).toBeInTheDocument();
    expect(screen.getByText('Assignment basics')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Fix Question 1 prompt is required/i }));

    expect(issueSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'question_prompt_required',
        questionId: draft.assessmentDraft.sections[0].questions[0].id,
      })
    );
  });

  it('shows ready state when no blockers remain', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    draft.title = 'Unit 1';
    draft.classId = 'class-1';
    draft.dueDate = '10:00 30/06/2026';
    draft.assessmentDraft.sections[0].questions[0] = {
      ...draft.assessmentDraft.sections[0].questions[0],
      prompt: 'Choose the right answer.',
      options: [
        { key: 'A', text: 'Alpha' },
        { key: 'B', text: 'Beta' },
      ],
      correctAnswer: 'A',
    };

    render(
      <PublishReadinessPanel
        draft={draft}
        isPublishing={false}
        onIssueSelect={vi.fn()}
        onPublish={vi.fn()}
      />
    );

    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });
});
