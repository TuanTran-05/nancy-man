// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import { SettingsDrawer } from './SettingsDrawer';

describe('SettingsDrawer', () => {
  it('updates class, due date, attempts, and proctoring fields', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    const onDraftFieldsChange = vi.fn();
    render(
      <SettingsDrawer
        open
        draft={draft}
        classes={[{ id: 'class-1', name: 'A1' } as any]}
        students={[]}
        isPublishing={false}
        onClose={vi.fn()}
        onDraftFieldsChange={onDraftFieldsChange}
        onDeliveryPolicyChange={vi.fn()}
        onIssueSelect={vi.fn()}
        onPublish={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Class assignment'), { target: { value: 'class-1' } });
    expect(onDraftFieldsChange).toHaveBeenCalledWith({ classId: 'class-1' });

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '10:00 30/06/2026' } });
    expect(onDraftFieldsChange).toHaveBeenCalledWith({ dueDate: '10:00 30/06/2026' });

    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '2' } });
    expect(onDraftFieldsChange).toHaveBeenCalledWith({ attemptsAllowed: 2 });

    fireEvent.change(screen.getByLabelText('Anti-cheating mode'), { target: { value: 'normal' } });
    expect(onDraftFieldsChange).toHaveBeenCalledWith({ proctoringMode: 'normal' });
  });
});
