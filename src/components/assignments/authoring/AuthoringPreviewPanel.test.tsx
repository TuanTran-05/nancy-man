// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import { AuthoringPreviewPanel } from './AuthoringPreviewPanel';

describe('AuthoringPreviewPanel', () => {
  it('renders nothing while closed', () => {
    const draft = createBlankAuthoringDraft('teacher-1');

    render(<AuthoringPreviewPanel draft={draft} open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows draft metadata and student preview while open', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    draft.title = 'Preview assignment';
    draft.classId = 'class-1';
    draft.dueDate = '10:00 30/06/2026';
    draft.assessmentDraft.sections[0].questions[0] = {
      ...draft.assessmentDraft.sections[0].questions[0],
      prompt: 'What does the speaker want?',
      options: [
        { key: 'A', text: 'A ticket' },
        { key: 'B', text: 'A book' },
      ],
    };
    const close = vi.fn();

    render(<AuthoringPreviewPanel draft={draft} open onClose={close} />);

    expect(screen.getByRole('dialog', { name: 'Student preview' })).toBeInTheDocument();
    expect(screen.getByText('Preview assignment')).toBeInTheDocument();
    expect(screen.getByText('What does the speaker want?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));

    expect(close).toHaveBeenCalled();
  });
});
