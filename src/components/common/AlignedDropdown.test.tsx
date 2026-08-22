// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlignedDropdown } from './AlignedDropdown';

describe('AlignedDropdown', () => {
  it('renders a reusable left-aligned dropdown menu and selects an option', async () => {
    const onChange = vi.fn();

    render(
      <AlignedDropdown
        ariaLabel="Class filter"
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', label: 'Tất cả lớp' },
          { value: 'g2', label: 'G2 - Huynh Le - Ms. Huynh Le' },
        ]}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Class filter' });
    expect(trigger).toHaveClass('text-left');

    await userEvent.click(trigger);

    const option = screen.getByRole('option', { name: 'G2 - Huynh Le - Ms. Huynh Le' });
    expect(option).toHaveClass('text-left');
    expect(option.closest('[role="listbox"]')?.parentElement).toBe(document.body);

    await userEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('g2');
  });
});
