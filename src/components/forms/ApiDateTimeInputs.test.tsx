// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiDateTextInput, ApiTimeTextInput } from './ApiDateTimeInputs';

describe('ApiDateTextInput', () => {
  it('displays canonical API dates as dd/MM/yyyy', () => {
    render(<ApiDateTextInput label="Start date" value="2026-06-05" onChange={vi.fn()} />);

    expect(screen.getByLabelText('Start date')).toHaveValue('05/06/2026');
  });

  it('normalizes user dates and emits canonical API dates on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ApiDateTextInput label="Start date" value="" onChange={onChange} />);

    await user.type(screen.getByLabelText('Start date'), '9/5/2025');
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith('2025-05-09');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('inserts date separators while users type compact digits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ApiDateTextInput label="Start date" value="" onChange={onChange} />);

    await user.type(screen.getByLabelText('Start date'), '09052026');

    expect(screen.getByLabelText('Start date')).toHaveValue('09/05/2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-05-09');
  });

  it('updates from the native calendar picker', () => {
    const onChange = vi.fn();
    render(<ApiDateTextInput label="Start date" value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Native calendar picker'), {
      target: { value: '2026-05-09' },
    });

    expect(onChange).toHaveBeenCalledWith('2026-05-09');
    expect(screen.getByLabelText('Start date')).toHaveValue('09/05/2026');
  });

  it('shows an error and preserves parent value for invalid dates', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ApiDateTextInput label="Start date" value="" onChange={onChange} />);

    await user.type(screen.getByLabelText('Start date'), '31/04/2025');
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith('2025-04-31');
    expect(screen.getByRole('alert')).toHaveTextContent('Ngay khong hop le');
  });
});

describe('ApiTimeTextInput', () => {
  it('normalizes user times and emits canonical API times on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ApiTimeTextInput label="Start time" value="" onChange={onChange} />);

    await user.type(screen.getByLabelText('Start time'), '5:9');
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith('05:09:00');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('inserts time separators while users type compact digits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ApiTimeTextInput label="Start time" value="" onChange={onChange} />);

    await user.type(screen.getByLabelText('Start time'), '0905');

    expect(screen.getByLabelText('Start time')).toHaveValue('09:05');
    expect(onChange).toHaveBeenLastCalledWith('09:05:00');
  });

  it('updates from the native time picker', () => {
    const onChange = vi.fn();
    render(<ApiTimeTextInput label="Start time" value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Native time picker'), {
      target: { value: '14:30' },
    });

    expect(onChange).toHaveBeenCalledWith('14:30:00');
    expect(screen.getByLabelText('Start time')).toHaveValue('14:30');
  });
});
