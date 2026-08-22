// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimeTextInput } from './DateTimeTextInput';

function StatefulDateTimeTextInput({ mode }: { mode: 'date' | 'time' }) {
  const [value, setValue] = useState('');
  return <DateTimeTextInput mode={mode} label="Field" value={value} onChange={setValue} />;
}

function StatefulDateTimePickerInput() {
  const [value, setValue] = useState('');
  return <DateTimeTextInput mode="datetime" label="Field" value={value} onChange={setValue} />;
}

describe('DateTimeTextInput', () => {
  it('normalizes date values on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateTimeTextInput mode="date" label="Date" value="9/5/2025" onChange={onChange} />);

    await user.click(screen.getByLabelText('Date'));
    await user.tab();

    expect(onChange).toHaveBeenCalledWith('09/05/2025');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('inserts date separators while users type compact digits', async () => {
    const user = userEvent.setup();
    render(<StatefulDateTimeTextInput mode="date" />);

    await user.type(screen.getByLabelText('Field'), '09052026');

    expect(screen.getByLabelText('Field')).toHaveValue('09/05/2026');
  });

  it('normalizes time values and defaults missing seconds', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateTimeTextInput mode="time" label="Time" value="5:9" onChange={onChange} />);

    await user.click(screen.getByLabelText('Time'));
    await user.tab();

    expect(onChange).toHaveBeenCalledWith('05:09:00');
  });

  it('inserts time separators while users type compact digits', async () => {
    const user = userEvent.setup();
    render(<StatefulDateTimeTextInput mode="time" />);

    await user.type(screen.getByLabelText('Field'), '0905');

    expect(screen.getByLabelText('Field')).toHaveValue('09:05');
  });

  it('updates datetime values from the native picker', () => {
    render(<StatefulDateTimePickerInput />);

    fireEvent.change(screen.getByLabelText('Native date and time picker'), {
      target: { value: '2026-05-09T14:30' },
    });

    expect(screen.getByLabelText('Field')).toHaveValue('14:30:00 09/05/2026');
  });

  it('shows an error for invalid values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateTimeTextInput mode="date" label="Date" value="31/04/2025" onChange={onChange} />);

    await user.click(screen.getByLabelText('Date'));
    await user.tab();

    expect(onChange).not.toHaveBeenCalledWith('31/04/2025');
    expect(screen.getByRole('alert')).toHaveTextContent('Ngay khong hop le');
  });
});
