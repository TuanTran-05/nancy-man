// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import { AuthoringDraftList } from './AuthoringDraftList';

describe('AuthoringDraftList', () => {
  function draft(overrides: Partial<ReturnType<typeof createBlankAuthoringDraft>> = {}) {
    return { ...createBlankAuthoringDraft('teacher-1'), id: 'draft-1', ...overrides };
  }

  it('renders draft rows as a quiet list and opens a draft when clicked', () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <AuthoringDraftList
        drafts={[
          draft({
            title: 'Unit 2 Listening',
            classId: 'class-1',
            dueDate: '2026-06-30T10:00:00.000Z',
            updatedAt: '2026-06-12T10:00:00.000Z',
          }),
        ]}
        classes={[{ id: 'class-1', name: 'G7A' }]}
        loading={false}
        error=""
        labels={{
          heading: 'Drafts',
          autoSaveNote: 'Auto-saved while editing',
          untitled: 'Untitled draft',
          missingClass: 'Missing class',
          missingDueDate: 'Missing due date',
          questions: 'questions',
          open: 'Open',
          delete: 'Delete',
          retry: 'Retry',
          updated: 'Updated',
          ready: 'Ready',
          needsDetails: 'Needs details',
        }}
        onOpen={onOpen}
        onDelete={onDelete}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('Drafts')).toBeInTheDocument();
    expect(screen.getByText('Unit 2 Listening')).toBeInTheDocument();
    expect(screen.getByText(/G7A/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Unit 2 Listening'));

    expect(onOpen).toHaveBeenCalledWith('draft-1');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('asks the parent to delete a draft without opening the row', () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <AuthoringDraftList
        drafts={[draft({ title: 'Speaking homework' })]}
        classes={[]}
        loading={false}
        error=""
        labels={{
          heading: 'Drafts',
          autoSaveNote: 'Auto-saved while editing',
          untitled: 'Untitled draft',
          missingClass: 'Missing class',
          missingDueDate: 'Missing due date',
          questions: 'questions',
          open: 'Open',
          delete: 'Delete',
          retry: 'Retry',
          updated: 'Updated',
          ready: 'Ready',
          needsDetails: 'Needs details',
        }}
        onOpen={onOpen}
        onDelete={onDelete}
        onRetry={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Speaking homework' }));

    expect(onDelete).toHaveBeenCalledWith('draft-1');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders a compact retry row for fetch errors', () => {
    const onRetry = vi.fn();
    render(
      <AuthoringDraftList
        drafts={[]}
        classes={[]}
        loading={false}
        error="Could not load drafts"
        labels={{
          heading: 'Drafts',
          autoSaveNote: 'Auto-saved while editing',
          untitled: 'Untitled draft',
          missingClass: 'Missing class',
          missingDueDate: 'Missing due date',
          questions: 'questions',
          open: 'Open',
          delete: 'Delete',
          retry: 'Retry',
          updated: 'Updated',
          ready: 'Ready',
          needsDetails: 'Needs details',
        }}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('Could not load drafts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
