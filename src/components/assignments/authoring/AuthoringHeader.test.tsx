// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthoringHeader } from './AuthoringHeader';

describe('AuthoringHeader', () => {
  it('renders title, save state, preview, draft save, and publish controls', () => {
    const onTitleChange = vi.fn();
    render(
      <MemoryRouter>
        <AuthoringHeader
          title="Unit 5"
          syncStatus="synced"
          isPublishing={false}
          onTitleChange={onTitleChange}
          onPreview={vi.fn()}
          onSaveDraft={vi.fn()}
          onPublish={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('textbox', { name: 'Assignment title' })).toHaveValue('Unit 5');
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment title' }), {
      target: { value: 'Unit 6' },
    });
    expect(onTitleChange).toHaveBeenCalledWith('Unit 6');
  });
});
