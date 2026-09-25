// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchemaTree } from './SchemaTree.js';
import type { DatabaseExplorerSchema } from '../../../../../packages/contracts/src/databaseExplorer.js';

afterEach(() => cleanup());

const mockSchemas: DatabaseExplorerSchema[] = [
  {
    name: 'public',
    relations: [
      {
        name: 'users',
        kind: 'table',
        rowLevelSecurity: { enabled: true, forced: false },
        columns: [],
        constraints: [],
        indexes: [],
        triggers: [],
        policies: [],
        estimatedRows: 1200,
        dataAvailable: true,
        primaryKey: ['id'],
        paginationKey: ['id']
      },
      {
        name: 'courses',
        kind: 'table',
        rowLevelSecurity: { enabled: false, forced: false },
        columns: [],
        constraints: [],
        indexes: [],
        triggers: [],
        policies: [],
        estimatedRows: 45,
        dataAvailable: true,
        primaryKey: ['id'],
        paginationKey: ['id']
      }
    ]
  },
  {
    name: 'analytics',
    relations: [
      {
        name: 'daily_active_users_view',
        kind: 'view',
        rowLevelSecurity: { enabled: false, forced: false },
        columns: [],
        constraints: [],
        indexes: [],
        triggers: [],
        policies: [],
        estimatedRows: null,
        dataAvailable: true,
        primaryKey: null,
        paginationKey: null
      }
    ]
  }
];

describe('SchemaTree component', () => {
  it('renders schema disclosure groups and relations with counts and kind badges', () => {
    render(
      <SchemaTree
        schemas={mockSchemas}
        selectedSchema="public"
        selectedRelation="users"
        onSelectRelation={() => {}}
      />
    );

    expect(screen.getByText('public')).toBeInTheDocument();
    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.getByText('~1200')).toBeInTheDocument();
    expect(screen.getByText('courses')).toBeInTheDocument();
    expect(screen.getByText('analytics')).toBeInTheDocument();
    expect(screen.getByText('daily_active_users_view')).toBeInTheDocument();
  });

  it('filters relations case-insensitively and shows empty state on no match', async () => {
    const user = userEvent.setup();
    render(
      <SchemaTree
        schemas={mockSchemas}
        selectedSchema="public"
        selectedRelation="users"
        onSelectRelation={() => {}}
      />
    );

    const searchInput = screen.getByPlaceholderText('Lọc bảng...');
    await user.type(searchInput, 'daily');

    expect(screen.queryByText('users')).not.toBeInTheDocument();
    expect(screen.getByText('daily_active_users_view')).toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'nonexistent_table');

    expect(screen.getByText('Không tìm thấy bảng hoặc view phù hợp')).toBeInTheDocument();
  });

  it('calls onSelectRelation when relation button is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <SchemaTree
        schemas={mockSchemas}
        selectedSchema="public"
        selectedRelation="users"
        onSelectRelation={onSelect}
      />
    );

    await user.click(screen.getByText('courses'));
    expect(onSelect).toHaveBeenCalledWith('public', 'courses');
  });
});
