// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VariableEditor, variableEditPolicy } from './VariableEditor.js';

const item = {
  name: 'OPTIONAL_VALUE',
  value: '<script>sentinel</script>',
  mutability: 'managed' as const,
  requirement: 'optional' as const
};

describe('VariableEditor', () => {
  it('only allows deletion for managed optional definitions and confirms it', () => {
    expect(variableEditPolicy(item)).toMatchObject({ editable: true, deletable: true });
    const onDelete = vi.fn();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );
    render(<VariableEditor item={item as never} onStage={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tùy chọn' }));
    expect(onDelete).not.toHaveBeenCalled();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tùy chọn' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('<script>sentinel</script>')).not.toBeInTheDocument();
  });

  it('renders observed and unknown definitions as read-only', () => {
    expect(variableEditPolicy({ mutability: 'observed', requirement: 'required' })).toMatchObject({
      editable: false,
      deletable: false
    });
    expect(variableEditPolicy({ mutability: 'managed', requirement: 'unknown' })).toMatchObject({
      editable: false,
      deletable: false
    });
  });
});
