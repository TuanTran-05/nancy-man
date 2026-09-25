// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from './FilterBar.js';
import type { DatabaseExplorerColumn } from '../../../../../../packages/contracts/src/databaseExplorer.js';

afterEach(() => cleanup());

const mockColumns: DatabaseExplorerColumn[] = [
  {
    name: 'id',
    dataType: 'uuid',
    nullable: false,
    hasDefault: true,
    identity: null,
    generated: false,
    classification: 'public',
    selectable: true,
    filterOperators: ['eq', 'neq']
  },
  {
    name: 'email',
    dataType: 'text',
    nullable: false,
    hasDefault: false,
    identity: null,
    generated: false,
    classification: 'pii',
    selectable: true,
    filterOperators: ['eq', 'contains', 'is_null', 'is_not_null']
  },
  {
    name: 'password_hash',
    dataType: 'text',
    nullable: false,
    hasDefault: false,
    identity: null,
    generated: false,
    classification: 'blocked',
    selectable: false,
    filterOperators: []
  }
];

describe('FilterBar component', () => {
  it('does not allow filtering on blocked columns and enforces max 5 filters', async () => {
    const user = userEvent.setup();
    const onAddFilter = vi.fn();

    render(
      <FilterBar
        columns={mockColumns}
        filters={[]}
        onAddFilter={onAddFilter}
        onRemoveFilter={() => {}}
        pageSize={25}
        onPageSizeChange={() => {}}
      />
    );

    // Blocked column password_hash should NOT be an option in column selector
    const columnSelect = screen.getByRole('combobox', { name: 'Chọn cột lọc' });
    expect(screen.getByRole('option', { name: 'id' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'email' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'password_hash' })).not.toBeInTheDocument();

    // Adding filter for email contains "test"
    await user.selectOptions(columnSelect, 'email');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Toán tử lọc' }), 'contains');
    await user.type(
      screen.getByPlaceholderText('Giá trị lọc (tối đa 200 ký tự)'),
      'test@example.com'
    );

    await user.click(screen.getByRole('button', { name: 'Thêm lọc' }));
    expect(onAddFilter).toHaveBeenCalledWith({
      column: 'email',
      operator: 'contains',
      value: 'test@example.com'
    });
  });

  it('disables value input when operator is is_null or is_not_null', async () => {
    const user = userEvent.setup();

    render(
      <FilterBar
        columns={mockColumns}
        filters={[]}
        onAddFilter={() => {}}
        onRemoveFilter={() => {}}
        pageSize={25}
        onPageSizeChange={() => {}}
      />
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Chọn cột lọc' }), 'email');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Toán tử lọc' }), 'is_null');

    expect(screen.getByPlaceholderText('Không cần giá trị')).toBeDisabled();
  });

  it('disables add filter when 5 filters already exist', () => {
    const existingFilters = [
      { column: 'id', operator: 'eq' as const, value: '1' },
      { column: 'id', operator: 'eq' as const, value: '2' },
      { column: 'id', operator: 'eq' as const, value: '3' },
      { column: 'id', operator: 'eq' as const, value: '4' },
      { column: 'id', operator: 'eq' as const, value: '5' }
    ];

    render(
      <FilterBar
        columns={mockColumns}
        filters={existingFilters}
        onAddFilter={() => {}}
        onRemoveFilter={() => {}}
        pageSize={50}
        onPageSizeChange={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Đạt tối đa 5 bộ lọc' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /Xóa lọc/i })).toHaveLength(5);
  });
});
