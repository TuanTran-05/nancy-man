// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthoringTabs } from './AuthoringTabs';

describe('AuthoringTabs', () => {
  it('uses accessible tab semantics and changes tabs', () => {
    const onChange = vi.fn();
    render(<AuthoringTabs activeTab="questions" onChange={onChange} />);

    expect(
      screen.getByRole('tablist', { name: 'Assignment builder sections' })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(onChange).toHaveBeenCalledWith('settings');
  });
});
