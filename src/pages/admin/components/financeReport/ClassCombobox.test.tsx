// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';

import { ClassCombobox, type ClassComboboxOption } from './ClassCombobox';

const LABEL = 'Lớp';
const PLACEHOLDER = 'Tìm lớp theo tên lớp hoặc giáo viên';
const EMPTY_TEXT = 'Không tìm thấy lớp phù hợp';
const CLEAR_LABEL = 'Xóa lớp đã chọn';

const OPTIONS: ClassComboboxOption[] = [
  {
    id: 'c1',
    label: 'Tiếng Anh 1A - Nguyễn Văn A · Đang học',
    searchText: 'Tiếng Anh 1A Nguyễn Văn A',
  },
  { id: 'c2', label: 'Toán 2B - Trần Thị B · Tạm dừng', searchText: 'Toán 2B Trần Thị B' },
];

function Harness({
  options = OPTIONS,
  initialValue = '',
  disabled = false,
  onChange,
}: {
  options?: ClassComboboxOption[];
  initialValue?: string;
  disabled?: boolean;
  onChange?: (id: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <ClassCombobox
      options={options}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
      label={LABEL}
      placeholder={PLACEHOLDER}
      emptyText={EMPTY_TEXT}
      clearLabel={CLEAR_LABEL}
      disabled={disabled}
    />
  );
}

function renderCombobox(props: React.ComponentProps<typeof Harness> = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  return { user, input: screen.getByLabelText(LABEL) as HTMLInputElement };
}

function optionLabels(): string[] {
  return screen.queryAllByRole('option').map((option) => option.textContent || '');
}

describe('ClassCombobox opening and filtering', () => {
  it('keeps the option list closed until the box is focused', () => {
    renderCombobox();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows every class the moment the box is focused, before anything is typed', async () => {
    const { user, input } = renderCombobox();

    await user.click(input);

    expect(optionLabels()).toEqual([OPTIONS[0].label, OPTIONS[1].label]);
  });

  it('narrows the list on every keystroke', async () => {
    const { user, input } = renderCombobox();

    await user.click(input);
    await user.keyboard('t');
    expect(optionLabels()).toHaveLength(2);

    await user.keyboard('o');
    expect(optionLabels()).toEqual([OPTIONS[1].label]);
  });

  it('matches an unaccented query against the teacher name', async () => {
    const { user, input } = renderCombobox();

    await user.click(input);
    await user.keyboard('tran thi b');

    expect(optionLabels()).toEqual([OPTIONS[1].label]);
  });

  it('shows the empty message when nothing matches', async () => {
    const { user, input } = renderCombobox();

    await user.click(input);
    await user.keyboard('zzz');

    expect(optionLabels()).toEqual([]);
    expect(screen.getByText(EMPTY_TEXT)).toBeTruthy();
  });
});

describe('ClassCombobox selection', () => {
  it('reports the picked class id and shows its label in the box', async () => {
    const onChange = vi.fn();
    const { user, input } = renderCombobox({ onChange });

    await user.click(input);
    await user.click(screen.getByTestId('class-option:c2'));

    expect(onChange).toHaveBeenCalledWith('c2');
    expect(input.value).toBe(OPTIONS[1].label);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picks the highlighted option with the keyboard', async () => {
    const onChange = vi.fn();
    const { user, input } = renderCombobox({ onChange });

    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('c2');
  });

  it('does not disturb the current selection while a query is being typed', async () => {
    const onChange = vi.fn();
    const { user, input } = renderCombobox({ initialValue: 'c1', onChange });

    await user.click(input);
    await user.keyboard('zzz');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('restores the selected label when the panel closes without a pick', async () => {
    const { user, input } = renderCombobox({ initialValue: 'c1' });

    await user.click(input);
    await user.keyboard('zzz');
    expect(input.value).toBe('zzz');

    await user.keyboard('{Escape}');

    expect(input.value).toBe(OPTIONS[0].label);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('offers the current class as the placeholder while the query box is empty', async () => {
    const { user, input } = renderCombobox({ initialValue: 'c1' });

    expect(input.value).toBe(OPTIONS[0].label);

    await user.click(input);

    expect(input.value).toBe('');
    expect(input.placeholder).toBe(OPTIONS[0].label);
  });
});

describe('ClassCombobox clearing', () => {
  it('has no clear button until a class is selected', () => {
    renderCombobox();
    expect(screen.queryByRole('button', { name: CLEAR_LABEL })).toBeNull();
  });

  it('clears the selection from the clear button', async () => {
    const onChange = vi.fn();
    const { user, input } = renderCombobox({ initialValue: 'c1', onChange });

    await user.click(screen.getByRole('button', { name: CLEAR_LABEL }));

    expect(onChange).toHaveBeenCalledWith('');
    expect(input.value).toBe('');
    expect(screen.queryByRole('button', { name: CLEAR_LABEL })).toBeNull();
  });
});

describe('ClassCombobox disabled state', () => {
  it('does not open while disabled', async () => {
    const { user, input } = renderCombobox({ disabled: true });

    expect(input.disabled).toBe(true);
    await user.click(input);

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
