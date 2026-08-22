// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BulkQuestionActions } from './BulkQuestionActions';

describe('BulkQuestionActions', () => {
  it('emits bulk points, level, skill, move, and delete commands', () => {
    const onBulkUpdate = vi.fn();
    const onMove = vi.fn();
    const onDelete = vi.fn();
    render(
      <BulkQuestionActions
        selectedCount={2}
        sections={[
          { id: 's1', title: 'Listening' },
          { id: 's2', title: 'Reading' },
        ]}
        onBulkUpdate={onBulkUpdate}
        onMove={onMove}
        onDelete={onDelete}
      />
    );

    fireEvent.change(screen.getByLabelText('Bulk points'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Bulk level'), { target: { value: 'B1' } });
    fireEvent.change(screen.getByLabelText('Bulk skill'), { target: { value: 'reading' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk edit' }));
    expect(onBulkUpdate).toHaveBeenCalledWith({ points: 3, level: 'B1', skill: 'reading' });

    fireEvent.change(screen.getByLabelText('Move selected to section'), {
      target: { value: 's2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }));
    expect(onMove).toHaveBeenCalledWith('s2');

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    expect(onDelete).toHaveBeenCalled();
  });
});
