// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import { PreviewDrawer } from './PreviewDrawer';

describe('PreviewDrawer', () => {
  it('renders student preview and allows closing', () => {
    const draft = { ...createBlankAuthoringDraft('teacher-1'), title: 'Unit 1' };
    const onClose = vi.fn();
    render(<PreviewDrawer open draft={draft} device="desktop" onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Student preview' })).toBeInTheDocument();
    expect(screen.getByText('Unit 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalled();
  });
});
