// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplatePicker } from './TemplatePicker';

describe('TemplatePicker', () => {
  it('emits a selected template id', () => {
    const onSelect = vi.fn();
    render(<TemplatePicker onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Listening practice/i }));

    expect(onSelect).toHaveBeenCalledWith('listening-practice');
  });
});
